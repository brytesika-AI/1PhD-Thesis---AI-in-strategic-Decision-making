import { getAgentForStage, nextAgentId } from "../shared/agent-registry.js";
import { EventHooks } from "./event-hooks.js";
import { EventBus } from "../events/event-bus.js";
import { PolicyEngine } from "../policy/policy-engine.js";
import { executeToolWithHooks, validateToolOutput } from "../skills/index.js";
import { emptyCaseState } from "../state/d1-case-store.js";

function summarize(value, max = 240) {
  return JSON.stringify(value || {}).slice(0, max);
}

const AGENT_TOOL_MAP = {
  tracker: "gather_evidence",
  induna: "extract_assumptions",
  auditor: "root_cause_analysis",
  innovator: "generate_options",
  challenger: "generate_objections",
  architect: "build_implementation_plan",
  guardian: "generate_monitoring_rules",
  policy_sentinel: "validate_policy",
  consensus_tracker: "validate_consensus"
};

export class OrchestrationGateway {
  constructor({ registryDocument, caseStore, auditLog, ai, cache = null }) {
    this.registryDocument = registryDocument;
    this.caseStore = caseStore;
    this.auditLog = auditLog;
    this.ai = ai;
    this.cache = cache;
    this.policy = new PolicyEngine(registryDocument);
    this.hooks = new EventHooks({ auditLog, caseStore });
    this.events = new EventBus({ auditLog });
  }

  async executeStage({ caseId, stage, userGoal, riskState = "ELEVATED", sector = "general", user = null }) {
    const agent = getAgentForStage(this.registryDocument, stage);
    if (!agent) {
      return { error: "Invalid stage.", status: 400 };
    }

    let caseState = await this.caseStore.getCase(caseId);
    if (!caseState) {
      caseState = emptyCaseState(caseId, userGoal);
      caseState.created_by = user?.user_id || null;
      caseState.organization_id = user?.organization_id || null;
      caseState.organization_name = user?.organization_name || null;
      await this.hooks.emit("audit_event", {
        event_type: "case_created",
        case_id: caseId,
        agent_id: "gateway",
        user_id: user?.user_id || null,
        action: "case_created",
        input_summary: String(userGoal).slice(0, 160),
        output_summary: "Decision case created by Cloudflare gateway control plane.",
        tools_used: [],
        model_used: "gateway",
        policy_checks: [],
        human_approval: false
      });
    }
    caseState.last_modified_by = user?.user_id || caseState.last_modified_by || null;

    const pendingGate = [...caseState.approval_gates].reverse().find((gate) => gate.status === "pending");
    if (pendingGate && Number(stage) > Number(pendingGate.stage_id)) {
      return {
        error: "Human approval required before the next stage can execute.",
        approval_required: true,
        approval_gate: pendingGate,
        case_state: caseState
      };
    }

    const toolName = AGENT_TOOL_MAP[agent.id] || agent.allowed_tools[0];
    const output = validateToolOutput(await executeToolWithHooks({
      agentId: agent.id,
      toolName,
      input: {
        text: userGoal,
        context: { ...caseState, risk_state: riskState, sector },
        llm: this.ai,
        cache: this.cache
      },
      policy: this.policy,
      eventBus: this.events,
      caseId
    }));
    const toolResults = {};
    const policyChecks = [];
    toolResults[toolName] = { ...output };
    if (output.policy_check) policyChecks.push(output.policy_check);
    if (output.after_policy_check) policyChecks.push(output.after_policy_check);

    const handoffTarget = nextAgentId(this.registryDocument, agent.id);
    policyChecks.push({
      agent_id: agent.id,
      handoff_target: handoffTarget,
      allowed: handoffTarget === null || handoffTarget === getAgentForStage(this.registryDocument, Number(stage) + 1)?.id,
      reason: "Declarative handoff rule evaluated."
    });

    output.tool_results = toolResults;
    const auditRef = await this.hooks.emit("audit_event", {
      case_id: caseId,
      agent_id: agent.id,
      input_summary: String(userGoal).slice(0, 160),
      output_summary: summarize(output),
      tools_used: Object.keys(toolResults),
      model_used: "tool-orchestrated",
      policy_checks: policyChecks,
      human_approval: this.policy.requiresApproval(agent.id),
      raw_payload: output
    });

    caseState.stage_outputs[String(stage)] = output;
    caseState.audit_log_refs.push(auditRef);
    caseState.current_stage = this.policy.requiresApproval(agent.id) ? Number(stage) : Math.min(Number(stage) + 1, 7);
    caseState.status = this.policy.requiresApproval(agent.id) ? "awaiting_approval" : "active";

    if (this.policy.requiresApproval(agent.id)) {
      caseState.approval_gates.push({
        approval_id: crypto.randomUUID(),
        stage_id: Number(stage),
        agent_id: agent.id,
        status: "pending",
        requested_at: new Date().toISOString(),
        audit_ref: auditRef
      });
    }

    await this.hooks.emit("state_snapshot", { case_state: caseState });
    await this.hooks.emit("monitoring_trigger_check", {
      case_id: caseId,
      agent_id: agent.id,
      monitoring_triggers: agent.monitoring_triggers
    });
    return {
      round: Number(stage),
      agent: agent.display_name,
      content: output,
      audit_ref: auditRef,
      case_state: caseState,
      approval_required: this.policy.requiresApproval(agent.id),
      approval_gate: caseState.approval_gates.at(-1) || null
    };
  }

  async decideApproval({ caseId, approvalId, approved, reviewer = "human", notes = "" }) {
    const caseState = await this.caseStore.getCase(caseId);
    if (!caseState) {
      return { error: "Case not found.", status: 404 };
    }

    const gate = caseState.approval_gates.find((item) => item.approval_id === approvalId);
    if (!gate) {
      return { error: "Approval gate not found.", status: 404 };
    }
    if (gate.status !== "pending") {
      return { error: `Approval gate already ${gate.status}.`, status: 409 };
    }

    gate.status = approved ? "approved" : "rejected";
    gate.reviewer = reviewer;
    gate.notes = notes;
    gate.decided_at = new Date().toISOString();
    caseState.status = approved ? "active" : "revision_required";
    caseState.current_stage = approved ? Math.min(Number(gate.stage_id) + 1, 7) : Number(gate.stage_id);

    const auditRef = await this.hooks.emit("audit_event", {
      event_type: approved ? "human_approval_approved" : "human_approval_rejected",
      case_id: caseId,
      agent_id: gate.agent_id,
      input_summary: `Approval decision for ${approvalId}`,
      output_summary: `Stage ${gate.stage_id} ${gate.status} by ${reviewer}`,
      tools_used: [],
      model_used: "human-review",
      policy_checks: [{ approval_id: approvalId, decision: gate.status, allowed: true }],
      human_approval: true,
      raw_payload: gate
    });
    caseState.audit_log_refs.push(auditRef);
    await this.hooks.emit("state_snapshot", { case_state: caseState });
    return { case_state: caseState, approval_gate: gate, audit_ref: auditRef };
  }

  async evaluateMonitoring({ caseId, failedAssumptions = [], trigger = "assumption_failure" }) {
    const caseState = await this.caseStore.getCase(caseId);
    if (!caseState) {
      return { error: "Case not found.", status: 404 };
    }

    if (!Array.isArray(failedAssumptions) || failedAssumptions.length === 0) {
      return {
        case_state: caseState,
        re_trigger_required: false,
        re_trigger_stage: null,
        reason: "No failed assumptions supplied."
      };
    }

    const reTriggerStage = 2;
    caseState.status = "monitoring_retriggered";
    caseState.current_stage = reTriggerStage;
    caseState.monitoring_rules = [
      ...(caseState.monitoring_rules || []),
      {
        trigger,
        failed_assumptions: failedAssumptions,
        re_trigger_stage: reTriggerStage,
        recorded_at: new Date().toISOString()
      }
    ];

    const auditRef = await this.hooks.emit("audit_event", {
      event_type: "monitoring_retrigger",
      case_id: caseId,
      agent_id: "guardian",
      input_summary: failedAssumptions.join("; ").slice(0, 160),
      output_summary: "Monitoring Agent re-triggered Socratic Partner assumption review.",
      tools_used: ["resilience_scoring"],
      model_used: "monitoring-policy",
      policy_checks: [{ trigger, allowed: true, re_trigger_stage: reTriggerStage }],
      human_approval: false,
      raw_payload: { failed_assumptions: failedAssumptions, re_trigger_stage: reTriggerStage }
    });
    caseState.audit_log_refs.push(auditRef);
    await this.hooks.emit("state_snapshot", { case_state: caseState });

    return {
      case_state: caseState,
      re_trigger_required: true,
      re_trigger_stage: reTriggerStage,
      audit_ref: auditRef
    };
  }
}
