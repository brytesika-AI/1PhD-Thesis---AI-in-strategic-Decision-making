import { getAgentForStage, nextAgentId } from "../shared/agent-registry.js";
import { EventHooks } from "./event-hooks.js";
import { PolicyEngine } from "../policy/policy-engine.js";
import { invokeSkill } from "../skills/index.js";
import { emptyCaseState } from "../state/d1-case-store.js";

function summarize(value, max = 240) {
  return JSON.stringify(value || {}).slice(0, max);
}

function requestedTools(payload) {
  const tools = payload?.tools_used || payload?.requested_tools || [];
  return Array.isArray(tools) ? tools : [tools];
}

export class OrchestrationGateway {
  constructor({ registryDocument, caseStore, auditLog, ai }) {
    this.registryDocument = registryDocument;
    this.caseStore = caseStore;
    this.auditLog = auditLog;
    this.ai = ai;
    this.policy = new PolicyEngine(registryDocument);
    this.hooks = new EventHooks({ auditLog, caseStore });
  }

  async executeStage({ caseId, stage, userGoal, riskState = "ELEVATED", sector = "general" }) {
    const agent = getAgentForStage(this.registryDocument, stage);
    if (!agent) {
      return { error: "Invalid stage.", status: 400 };
    }

    let caseState = await this.caseStore.getCase(caseId);
    if (!caseState) {
      caseState = emptyCaseState(caseId, userGoal);
      await this.hooks.emit("audit_event", {
        event_type: "case_created",
        case_id: caseId,
        agent_id: "gateway",
        input_summary: String(userGoal).slice(0, 160),
        output_summary: "Decision case created by Cloudflare gateway control plane.",
        tools_used: [],
        model_used: "gateway",
        policy_checks: [],
        human_approval: false
      });
    }

    const pendingGate = [...caseState.approval_gates].reverse().find((gate) => gate.status === "pending");
    if (pendingGate && Number(stage) > Number(pendingGate.stage_id)) {
      return {
        error: "Human approval required before the next stage can execute.",
        approval_required: true,
        approval_gate: pendingGate,
        case_state: caseState
      };
    }

    const systemPrompt = [
      `You are ${agent.display_name}: ${agent.role}.`,
      `Return JSON matching ${agent.output_schema}.`,
      `Allowed tools: ${agent.allowed_tools.join(", ") || "none"}.`,
      `Risk state: ${riskState}. Sector: ${sector}.`,
      `Current case state: ${JSON.stringify({
        current_stage: caseState.current_stage,
        status: caseState.status,
        user_goal: caseState.user_goal,
        assumptions: caseState.assumptions
      })}`
    ].join("\n");

    const model = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
    const aiResult = await this.ai.run(model, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userGoal }
      ],
      max_tokens: 1800
    });

    const outputText = aiResult?.response || "{}";
    let output;
    try {
      output = JSON.parse(outputText.match(/\{[\s\S]*\}/)?.[0] || outputText);
    } catch {
      output = { finding: "Model returned non-JSON output.", raw: outputText };
    }

    const toolResults = {};
    const policyChecks = [];
    for (const toolName of requestedTools(output)) {
      const check = this.policy.buildToolPolicyCheck(agent.id, toolName);
      policyChecks.push(check);
      if (check.allowed) {
        toolResults[toolName] = invokeSkill(toolName, { text: userGoal, context: caseState });
      }
    }

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
      model_used: model,
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
