import { DebateEngine } from "../core/debate-engine.js";
import { ConsensusTracker } from "../core/consensus-tracker.js";
import { EventBus } from "../events/event-bus.js";
import { PolicyEngine } from "../policy/policy-engine.js";
import { PIPELINE_ORDER, getAgent, getAgentForStage } from "../shared/agent-registry.js";
import { executeToolWithHooks } from "../skills/index.js";
import { emptyCaseState } from "../state/d1-case-store.js";
import { DecisionQueues } from "./queues.js";

function parseModelJson(text = "") {
  try {
    return JSON.parse(String(text).match(/\{[\s\S]*\}/)?.[0] || text);
  } catch {
    return { finding: "Model returned non-JSON output.", raw: String(text).slice(0, 1000) };
  }
}

function requestedTools(output) {
  const tools = output.tool_calls?.map((call) => call.name) || output.tools_used || output.requested_tools || [];
  return Array.isArray(tools) ? tools : [tools];
}

function stageForAgent(agentId) {
  const index = PIPELINE_ORDER.indexOf(agentId);
  return index >= 0 ? index + 1 : null;
}

function defaultActionForStage(stage) {
  const agentId = PIPELINE_ORDER[Number(stage) - 1];
  return agentId ? { type: "agent_turn", agent_id: agentId, stage: Number(stage), reason: "pipeline_progression" } : null;
}

function summarize(value, max = 240) {
  return JSON.stringify(value || {}).slice(0, max);
}

function normalizeCaseState(caseState, caseId, userGoal) {
  const defaults = emptyCaseState(caseId, userGoal);
  return {
    ...defaults,
    ...caseState,
    evidence_bundle: { ...defaults.evidence_bundle, ...(caseState?.evidence_bundle || {}) },
    consensus: { ...defaults.consensus, ...(caseState?.consensus || {}) },
    queues: { ...defaults.queues, ...(caseState?.queues || {}) },
    loop: { ...defaults.loop, ...(caseState?.loop || {}) },
    verification_chain: { ...defaults.verification_chain, ...(caseState?.verification_chain || {}) }
  };
}

export class DecisionLoop {
  constructor({ registryDocument, caseStore, auditLog, ai, maxIterations = 12 }) {
    this.registryDocument = registryDocument;
    this.caseStore = caseStore;
    this.auditLog = auditLog;
    this.ai = ai;
    this.maxIterations = maxIterations;
    this.policy = new PolicyEngine(registryDocument);
    this.events = new EventBus({ auditLog });
    this.debate = new DebateEngine({ maxRounds: 3 });
    this.consensus = new ConsensusTracker();
  }

  async run({ caseId, userGoal, maxIterations = this.maxIterations, riskState = "ELEVATED", sector = "general" }) {
    let caseState = await this.caseStore.getCase(caseId);
    if (!caseState) {
      caseState = emptyCaseState(caseId, userGoal);
      await this.events.emit("case_created", {
        case_id: caseId,
        agent_id: "decision_governor",
        input_summary: String(userGoal).slice(0, 160),
        output_summary: "Decision loop case created."
      });
    } else {
      caseState = normalizeCaseState(caseState, caseId, userGoal);
    }

    const queues = new DecisionQueues(caseState.queues);
    if (queues.isEmpty() && !caseState.loop?.stop_reason) {
      queues.enqueue("follow_up", defaultActionForStage(caseState.current_stage || 1));
    }

    await this.events.emit("turn_start", {
      case_id: caseId,
      agent_id: "decision_governor",
      input_summary: "Decision loop started.",
      raw_payload: { max_iterations: maxIterations }
    });

    let stopReason = null;
    let lastResult = null;
    for (let i = 0; i < maxIterations; i += 1) {
      const next = queues.dequeueNext() || this.selectNextAction(caseState);
      if (!next?.item && !next?.agent_id) {
        stopReason = "no_progress";
        break;
      }

      const action = next.item || next;
      await this.events.emit("queue_dequeued", {
        case_id: caseId,
        agent_id: "decision_governor",
        input_summary: `Dequeued ${action.agent_id}`,
        raw_payload: { queue: next.queue || "governor", action }
      });

      lastResult = await this.executeAgentTurn({
        caseState,
        queues,
        action,
        userGoal,
        riskState,
        sector
      });

      caseState = lastResult.case_state;
      caseState.queues = queues.snapshot();
      caseState.loop = {
        ...(caseState.loop || {}),
        iterations: Number(caseState.loop?.iterations || 0) + 1,
        max_iterations: maxIterations,
        last_agent_id: action.agent_id
      };

      const stopCheck = this.checkStopConditions(caseState, queues);
      if (stopCheck.stop) {
        stopReason = stopCheck.reason;
        break;
      }
    }

    caseState.loop = { ...(caseState.loop || {}), stop_reason: stopReason || "max_iterations" };
    if (caseState.loop.stop_reason === "decision_reached") {
      caseState.status = "closed";
      await this.events.emit("case_closed", {
        case_id: caseId,
        agent_id: "decision_governor",
        output_summary: "Decision loop closed with verification chain satisfied.",
        raw_payload: { decision: caseState.decision, consensus: caseState.consensus }
      });
    } else if (caseState.loop.stop_reason === "escalation_required") {
      caseState.status = "escalation_required";
    }

    await this.events.emit("turn_end", {
      case_id: caseId,
      agent_id: "decision_governor",
      output_summary: `Decision loop stopped: ${caseState.loop.stop_reason}`,
      raw_payload: { stop_reason: caseState.loop.stop_reason }
    });
    await this.caseStore.saveCase(caseState);
    return {
      case_id: caseId,
      stop_reason: caseState.loop.stop_reason,
      case_state: caseState,
      last_result: lastResult
    };
  }

  selectNextAction(caseState) {
    if (caseState.status === "awaiting_approval") return null;
    if (caseState.current_stage && caseState.current_stage <= 6) {
      return defaultActionForStage(caseState.current_stage);
    }
    if (!caseState.verification_chain?.policy_sentinel_validated) {
      return { type: "agent_turn", agent_id: "policy_sentinel", reason: "pre_decision_policy_validation" };
    }
    if (!caseState.verification_chain?.consensus_tracker_confirmed) {
      return { type: "agent_turn", agent_id: "consensus_tracker", reason: "pre_decision_consensus_validation" };
    }
    return null;
  }

  async executeAgentTurn({ caseState, queues, action, userGoal, riskState, sector }) {
    const agent = getAgent(this.registryDocument, action.agent_id);
    if (!agent) throw new Error(`Unknown loop agent: ${action.agent_id}`);

    await this.events.emit("agent_start", {
      case_id: caseState.case_id,
      agent_id: agent.id,
      input_summary: action.reason || "agent turn"
    });
    if (action.stage) {
      await this.events.emit("stage_start", {
        case_id: caseState.case_id,
        agent_id: agent.id,
        input_summary: `Stage ${action.stage} started.`
      });
    }

    const output = await this.generateAgentOutput({ agent, caseState, userGoal, riskState, sector });
    const toolResults = {};
    for (const toolName of requestedTools(output)) {
      toolResults[toolName] = await executeToolWithHooks({
        agentId: agent.id,
        toolName,
        input: { text: userGoal, context: caseState },
        policy: this.policy,
        eventBus: this.events,
        caseId: caseState.case_id
      });
    }
    output.tool_results = toolResults;

    this.updateCaseStateFromAgent(caseState, agent.id, action.stage, output);
    this.consensus.update(caseState, { agentId: agent.id, output });
    this.enqueueFollowUps({ caseState, queues, agentId: agent.id, stage: action.stage, output, action });

    await this.events.emit("agent_end", {
      case_id: caseState.case_id,
      agent_id: agent.id,
      output_summary: summarize(output),
      tools_used: Object.keys(toolResults),
      raw_payload: output
    });
    if (action.stage) {
      await this.events.emit("stage_end", {
        case_id: caseState.case_id,
        agent_id: agent.id,
        output_summary: `Stage ${action.stage} ended.`
      });
    }

    await this.caseStore.saveCase(caseState);
    return { agent_id: agent.id, output, case_state: caseState };
  }

  async generateAgentOutput({ agent, caseState, userGoal, riskState, sector }) {
    const model = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
    const prompt = [
      `You are ${agent.display_name}: ${agent.role}.`,
      "Return compact JSON only.",
      `Allowed tools: ${agent.allowed_tools.join(", ") || "none"}.`,
      `Risk state: ${riskState}. Sector: ${sector}.`,
      `Case state: ${JSON.stringify({
        current_stage: caseState.current_stage,
        status: caseState.status,
        assumptions: caseState.assumptions,
        objections: caseState.objections,
        consensus: caseState.consensus
      })}`
    ].join("\n");
    const result = await this.ai.run(model, {
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userGoal }
      ],
      max_tokens: 1400
    });
    return parseModelJson(result?.response || "{}");
  }

  updateCaseStateFromAgent(caseState, agentId, stage, output) {
    caseState.stage_outputs = { ...(caseState.stage_outputs || {}), [agentId]: output };
    if (stage) caseState.stage_outputs[String(stage)] = output;

    if (agentId === "tracker") {
      caseState.situational_briefing = output.situational_briefing || { finding: output.finding, signals: output.signals || [] };
      caseState.evidence_bundle = { ...(caseState.evidence_bundle || {}), signals: output.signals || [] };
    } else if (agentId === "induna") {
      caseState.assumptions = [...new Set([...(caseState.assumptions || []), ...(output.assumptions || [])])];
    } else if (agentId === "auditor") {
      caseState.evidence_bundle = { ...(caseState.evidence_bundle || {}), ...(output.evidence || {}) };
    } else if (agentId === "innovator") {
      caseState.options = output.options || caseState.options || [];
      caseState.options_generated = output.options || caseState.options_generated || [];
    } else if (agentId === "challenger") {
      caseState.verification_chain.devil_advocate_validated = true;
      caseState.devil_advocate_findings = {
        stress_tests: output.stress_tests || [],
        verdict: output.verdict || output.finding || ""
      };
      if (output.objection || (output.stress_tests || []).some((item) => item.risk)) {
        const claim = output.objection || output.stress_tests?.[0]?.risk || "Unresolved strategic risk.";
        this.debate.raiseObjection(caseState, {
          agentId,
          targetAgentId: "innovator",
          claim,
          severity: output.severity || "medium",
          confidence: output.confidence || 0.68
        });
      }
    } else if (agentId === "architect") {
      caseState.implementation_plan = output.implementation_plan || output.plan || {};
      caseState.current_stage = 7;
    } else if (agentId === "guardian") {
      caseState.monitoring_rules = output.monitoring_rules || caseState.monitoring_rules || [];
    } else if (agentId === "policy_sentinel") {
      const violation = output.policy_violation || output.violation;
      caseState.verification_chain.policy_sentinel_validated = !violation;
      if (violation) caseState.status = "escalation_required";
    } else if (agentId === "consensus_tracker") {
      caseState.verification_chain.consensus_tracker_confirmed = output.confirmed !== false;
      if (output.final_rationale) caseState.consensus.final_rationale = output.final_rationale;
    }

    const pipelineStage = stage || stageForAgent(agentId);
    if (pipelineStage && pipelineStage < 6 && agentId !== "challenger") {
      caseState.current_stage = Math.max(Number(caseState.current_stage || 1), pipelineStage + 1);
    }
  }

  enqueueFollowUps({ caseState, queues, agentId, stage, output, action }) {
    if (action?.reason === "challenge_requires_forensic_recheck") {
      const openObjection = (caseState.objections || []).find((item) => item.status === "open");
      if (openObjection) {
        this.debate.addRebuttal(caseState, {
          agentId,
          objectionId: openObjection.id,
          response: output.rebuttal || output.finding || "Forensic recheck completed.",
          confidence: output.confidence || 0.74
        });
      }
      return queues.enqueue("follow_up", {
        type: "agent_turn",
        agent_id: "architect",
        stage: 6,
        reason: "debate_recheck_completed"
      });
    }

    if (agentId === "challenger" && (caseState.objections || []).some((item) => item.status === "open") && this.debate.canContinue(caseState)) {
      const item = queues.enqueue("debate", {
        type: "agent_turn",
        agent_id: "auditor",
        stage: 3,
        reason: "challenge_requires_forensic_recheck"
      });
      return item;
    }

    if (stage && stage < 6) {
      return queues.enqueue("follow_up", {
        type: "agent_turn",
        agent_id: getAgentForStage(this.registryDocument, stage + 1).id,
        stage: stage + 1,
        reason: "pipeline_follow_up"
      });
    }

    if (agentId === "architect") {
      queues.enqueue("follow_up", { type: "agent_turn", agent_id: "policy_sentinel", reason: "final_policy_validation" });
      return queues.enqueue("follow_up", { type: "agent_turn", agent_id: "consensus_tracker", reason: "final_consensus_validation" });
    }
    return null;
  }

  checkStopConditions(caseState, queues) {
    if (caseState.status === "escalation_required") return { stop: true, reason: "escalation_required" };
    const preDecision = this.consensus.confirmBeforeDecision(caseState);
    if (preDecision.allowed && queues.isEmpty()) {
      caseState.decision = {
        status: "ready_for_human_approval",
        rationale: caseState.consensus.final_rationale,
        implementation_plan: caseState.implementation_plan
      };
      return { stop: true, reason: "decision_reached" };
    }
    if (queues.isEmpty() && Number(caseState.current_stage || 1) > 6) return { stop: false, reason: "validation_pending" };
    return { stop: false, reason: null };
  }
}
