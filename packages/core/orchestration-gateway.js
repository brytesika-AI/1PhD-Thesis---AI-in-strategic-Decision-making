import { getAgentForStage, nextAgentId } from "../shared/agent-registry.js";
import { EventHooks } from "./event-hooks.js";
import { EventBus } from "../events/event-bus.js";
import { blendFrameworks } from "../frameworks/framework-blender.js";
import { selectFrameworks } from "../frameworks/framework-selector.js";
import { buildOrganizationalIntelligence, deriveCaseType } from "../memory/d1-memory-store.js";
import { PolicyEngine } from "../policy/policy-engine.js";
import { executeToolWithHooks, validateToolOutput } from "../skills/index.js";
import { emptyCaseState } from "../state/d1-case-store.js";

function summarize(value, max = 240) {
  return JSON.stringify(value || {}).slice(0, max);
}

function buildCaseFacts(caseState = {}, userGoal = "", user = null) {
  return {
    case_id: String(caseState.case_id || ""),
    organization_id: caseState.organization_id || user?.organization_id || null,
    decision_type: caseState.decision_type || caseState.case_facts?.decision_type || deriveCaseType(userGoal || caseState.user_goal || "")
  };
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

const FRAMEWORK_STATE_MAP = {
  run_porters_five_forces: { framework: "porter", analysis: "industry" },
  run_swot_analysis: { framework: "swot", analysis: "internal" },
  run_pestle_analysis: { framework: "pestle", analysis: "environment" },
  run_value_chain_analysis: { framework: "value_chain", analysis: "value_chain" },
  run_scenario_planning: { framework: "scenario_planning", analysis: "scenarios" }
};

function stripPolicyMetadata(output = {}) {
  const { policy_check, after_policy_check, tools_used, ...rest } = output || {};
  return rest;
}

export class OrchestrationGateway {
  constructor({ registryDocument, caseStore, auditLog, ai, cache = null, memoryStore = null, digitalTwin = null }) {
    this.registryDocument = registryDocument;
    this.caseStore = caseStore;
    this.auditLog = auditLog;
    this.ai = ai;
    this.cache = cache;
    this.memoryStore = memoryStore;
    this.digitalTwin = digitalTwin;
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
    if (caseState?.organization_id && user?.organization_id && caseState.organization_id !== user.organization_id) {
      return { error: "Case not found.", status: 404 };
    }
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
    caseState.organization_id = caseState.organization_id || user?.organization_id || null;
    caseState.organization_name = caseState.organization_name || user?.organization_name || null;
    caseState.case_facts = buildCaseFacts(caseState, userGoal, user);
    if (this.digitalTwin?.getLatestTwinState && caseState.organization_id) {
      caseState.digital_twin = await this.digitalTwin.getLatestTwinState({ organizationId: caseState.organization_id, caseState });
      if (!caseState.digital_twin && this.digitalTwin.refreshTwinState) {
        const refreshed = await this.digitalTwin.refreshTwinState({ organizationId: caseState.organization_id, caseState });
        caseState.digital_twin = Array.isArray(refreshed?.updated) ? refreshed.updated[0] : refreshed;
      }
    }
    if (this.memoryStore) {
      caseState.shared_memory = await this.memoryStore.retrieve({ caseId, userGoal, user, caseState });
      caseState.memory = caseState.shared_memory;
      caseState.organizational_intelligence = caseState.shared_memory.organizational_intelligence || buildOrganizationalIntelligence(caseState.shared_memory);
    }
    caseState.framework_selection = caseState.framework_selection?.primary_framework
      ? caseState.framework_selection
      : await selectFrameworks({ ...caseState, case_description: userGoal || caseState.user_goal }, { ai: caseState.framework_selector_llm_enabled ? this.ai : null });

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
    const frameworkResults = await this.executeFrameworkTools({ agent, caseState, userGoal, riskState, sector });
    const output = validateToolOutput(await executeToolWithHooks({
      agentId: agent.id,
      toolName,
      input: {
        text: userGoal,
        context: {
          ...caseState,
          case_facts: caseState.case_facts,
          memory: caseState.shared_memory || caseState.memory || {},
          shared_memory: caseState.shared_memory || caseState.memory || {},
          frameworks: caseState.frameworks || {},
          analysis: caseState.analysis || {},
          digital_twin: caseState.digital_twin || null,
          risk_state: riskState,
          sector
        },
        llm: this.ai,
        cache: this.cache
      },
      policy: this.policy,
      eventBus: this.events,
      caseId
    }));
    const toolResults = { ...frameworkResults };
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
    output.frameworks = caseState.frameworks || {};
    output.analysis = caseState.analysis || {};
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
      organizational_intelligence: caseState.organizational_intelligence || null,
      case_state: caseState,
      approval_required: this.policy.requiresApproval(agent.id),
      approval_gate: caseState.approval_gates.at(-1) || null
    };
  }

  async executeFrameworkTools({ agent, caseState, userGoal, riskState, sector }) {
    const results = {};
    const selectedTools = this.frameworkToolsForAgent(caseState, agent.id);
    for (const frameworkTool of selectedTools) {
      const result = validateToolOutput(await executeToolWithHooks({
        agentId: agent.id,
        toolName: frameworkTool,
        input: {
          text: userGoal,
          context: {
            ...caseState,
            case_facts: caseState.case_facts,
            memory: caseState.shared_memory || caseState.memory || {},
            shared_memory: caseState.shared_memory || caseState.memory || {},
            frameworks: caseState.frameworks || {},
            analysis: caseState.analysis || {},
            digital_twin: caseState.digital_twin || null,
            risk_state: riskState,
            sector
          },
          llm: this.ai,
          cache: this.cache
        },
        policy: this.policy,
        eventBus: this.events,
        caseId: caseState.case_id
      }));
      const mapping = FRAMEWORK_STATE_MAP[frameworkTool];
      if (mapping) {
        const structured = stripPolicyMetadata(result);
        caseState.frameworks = { ...(caseState.frameworks || {}), [mapping.framework]: structured };
        caseState.framework_outputs = {
          ...(caseState.framework_outputs || {}),
          [mapping.framework === "scenario_planning" ? "scenario" : mapping.framework]: structured
        };
        caseState.analysis = { ...(caseState.analysis || {}), [mapping.analysis]: structured };
        caseState.blended_analysis = blendFrameworks(caseState.framework_outputs);
      }
      results[frameworkTool] = { ...result };
    }
    return results;
  }

  frameworkToolsForAgent(caseState, agentId) {
    if (agentId === "induna" || agentId === "policy_sentinel" || agentId === "consensus_tracker") return [];
    const agent = getAgentForStage(this.registryDocument, Number(caseState.current_stage || 1)) || this.registryDocument?.agents?.[agentId];
    const tools = caseState.framework_selection?.tool_names?.length
      ? caseState.framework_selection.tool_names
      : ["run_swot_analysis", "run_scenario_planning"];
    return tools.filter((toolName) => {
      const mapping = FRAMEWORK_STATE_MAP[toolName];
      return mapping && agent?.allowed_tools?.includes(toolName) && !caseState.frameworks?.[mapping.framework];
    });
  }

  async decideApproval({ caseId, approvalId, approved, reviewer = "human", notes = "", user = null }) {
    const caseState = await this.caseStore.getCase(caseId);
    if (!caseState) {
      return { error: "Case not found.", status: 404 };
    }
    if (caseState.organization_id && user?.organization_id && caseState.organization_id !== user.organization_id) {
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
    if (gate.type === "final_decision") {
      caseState.status = approved ? "closed" : "revision_required";
      caseState.current_stage = 7;
      caseState.decision = {
        ...(caseState.decision || {}),
        approval_status: gate.status,
        approved_by: approved ? reviewer : null,
        rejected_by: approved ? null : reviewer,
        approval_decided_at: gate.decided_at,
        approval_rationale: notes
      };
      caseState.loop = {
        ...(caseState.loop || {}),
        stop_reason: approved ? "decision_closed_by_human_approval" : "revision_requested_by_human"
      };
    } else {
      caseState.status = approved ? "active" : "revision_required";
      caseState.current_stage = approved ? Math.min(Number(gate.stage_id) + 1, 7) : Number(gate.stage_id);
      caseState.loop = {
        ...(caseState.loop || {}),
        stop_reason: approved ? null : "revision_requested_by_human"
      };
    }

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
    if (approved && gate.type === "final_decision") {
      const closedAuditRef = await this.hooks.emit("audit_event", {
        event_type: "case_closed",
        case_id: caseId,
        agent_id: "decision_governor",
        input_summary: "Final approval received.",
        output_summary: "Case closed after executive approval.",
        tools_used: [],
        model_used: "human-review",
        policy_checks: [{ approval_id: approvalId, decision: gate.status, allowed: true }],
        human_approval: true,
        raw_payload: { approval_gate: gate, decision: caseState.decision }
      });
      caseState.audit_log_refs.push(closedAuditRef);
    }
    await this.hooks.emit("state_snapshot", { case_state: caseState });
    return { case_state: caseState, approval_gate: gate, audit_ref: auditRef };
  }

  async evaluateMonitoring({ caseId, failedAssumptions = [], trigger = "assumption_failure", user = null }) {
    const caseState = await this.caseStore.getCase(caseId);
    if (!caseState) {
      return { error: "Case not found.", status: 404 };
    }
    if (caseState.organization_id && user?.organization_id && caseState.organization_id !== user.organization_id) {
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
