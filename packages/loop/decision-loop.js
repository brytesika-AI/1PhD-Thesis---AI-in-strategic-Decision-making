import { DebateEngine } from "../core/debate-engine.js";
import { ConsensusTracker } from "../core/consensus-tracker.js";
import { EventBus } from "../events/event-bus.js";
import { PolicyEngine } from "../policy/policy-engine.js";
import { PIPELINE_ORDER, getAgent, getAgentForStage } from "../shared/agent-registry.js";
import { executeToolWithHooks } from "../skills/index.js";
import { emptyCaseState } from "../state/d1-case-store.js";
import { DecisionQueues } from "./queues.js";

const MAX_JSON_RETRIES = 2;
const REQUIRED_STAGE_EVENTS = new Set(["agent_start", "agent_end", "state_updated", "consensus_update"]);
const CONSENSUS_RANK = { unknown: 0, low: 1, medium: 2, high: 3 };

const AGENT_OUTPUT_CONTRACTS = {
  tracker: {
    required: [{ key: "confidence", type: "number" }],
    optionalArrays: ["signals"]
  },
  induna: {
    required: [
      { key: "assumptions", type: "array", nonEmpty: true },
      { key: "confidence", type: "number" }
    ]
  },
  auditor: {
    required: [
      { key: "evidence", type: "object", nonEmpty: true },
      { key: "confidence", type: "number" }
    ]
  },
  innovator: {
    required: [
      { key: "options", type: "array", nonEmpty: true },
      { key: "confidence", type: "number" }
    ]
  },
  challenger: {
    required: [
      { key: "stress_tests", type: "array" },
      { key: "verdict", type: "string" },
      { key: "confidence", type: "number" }
    ]
  },
  architect: {
    requiredAny: [
      [{ key: "implementation_plan", type: "object", nonEmpty: true }],
      [{ key: "plan", type: "object", nonEmpty: true }]
    ],
    required: [{ key: "confidence", type: "number" }]
  },
  guardian: {
    required: [
      { key: "risk_signals", type: "array", nonEmpty: true },
      { key: "monitoring_rules", type: "array", nonEmpty: true },
      { key: "alert_thresholds", type: "array", nonEmpty: true },
      { key: "confidence", type: "number" }
    ]
  },
  policy_sentinel: {
    required: [{ key: "confidence", type: "number" }]
  },
  consensus_tracker: {
    required: [
      { key: "confirmed", type: "boolean" },
      { key: "final_rationale", type: "string" },
      { key: "confidence", type: "number" }
    ]
  }
};

function parseModelJson(text = "") {
  try {
    return { ok: true, value: JSON.parse(String(text).trim()) };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      raw: String(text).slice(0, 1000)
    };
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

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function appendUnique(existing = [], incoming = []) {
  const seen = new Set(existing.map((item) => JSON.stringify(item)));
  const merged = [...existing];
  for (const item of incoming) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

function mergeObjects(existing = {}, incoming = {}) {
  return { ...(existing || {}), ...(incoming || {}) };
}

function objectIsNonEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function validateField(output, field) {
  const value = output?.[field.key];
  if (field.type === "array" && !Array.isArray(value)) return `${field.key} must be an array`;
  if (field.type === "array" && field.nonEmpty && value.length === 0) return `${field.key} must not be empty`;
  if (field.type === "object" && (!value || typeof value !== "object" || Array.isArray(value))) return `${field.key} must be an object`;
  if (field.type === "object" && field.nonEmpty && !objectIsNonEmpty(value)) return `${field.key} must not be empty`;
  if (field.type === "number" && typeof value !== "number") return `${field.key} must be a number`;
  if (field.type === "string" && typeof value !== "string") return `${field.key} must be a string`;
  if (field.type === "boolean" && typeof value !== "boolean") return `${field.key} must be a boolean`;
  return null;
}

function validateAgentOutput(agent, output) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return { valid: false, reason: "Agent output must be a JSON object." };
  }
  const contract = AGENT_OUTPUT_CONTRACTS[agent.id];
  if (!contract) return { valid: true, reason: "No contract registered." };

  const failures = [];
  for (const field of contract.required || []) {
    const failure = validateField(output, field);
    if (failure) failures.push(failure);
  }
  if (contract.requiredAny?.length) {
    const anyValid = contract.requiredAny.some((fields) => fields.every((field) => !validateField(output, field)));
    if (!anyValid) {
      failures.push(`One of these field groups must be valid: ${contract.requiredAny.map((fields) => fields.map((field) => field.key).join("+")).join(" or ")}`);
    }
  }
  return failures.length ? { valid: false, reason: failures.join("; ") } : { valid: true, reason: "Output contract accepted." };
}

function schemaPromptFor(agent) {
  const contract = AGENT_OUTPUT_CONTRACTS[agent.id] || {};
  return JSON.stringify({
    required: contract.required || [],
    requiredAny: contract.requiredAny || [],
    tool_call_required: true,
    allowed_tools: agent.allowed_tools
  });
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
    verification_chain: { ...defaults.verification_chain, ...(caseState?.verification_chain || {}) },
    policy_violations: [...(caseState?.policy_violations || [])],
    revisions: [...(caseState?.revisions || [])]
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

  async run({ caseId, userGoal, maxIterations = this.maxIterations, riskState = "ELEVATED", sector = "general", user = null, entryStage = 1 }) {
    let caseState = await this.caseStore.getCase(caseId);
    if (!caseState) {
      caseState = emptyCaseState(caseId, userGoal);
      caseState.current_stage = Number(entryStage || 1);
      caseState.created_by = user?.user_id || null;
      caseState.organization_id = user?.organization_id || null;
      caseState.organization_name = user?.organization_name || null;
      await this.events.emit("case_created", {
        case_id: caseId,
        agent_id: "decision_governor",
        user_id: user?.user_id || null,
        action: "case_created",
        input_summary: String(userGoal).slice(0, 160),
        output_summary: "Decision loop case created."
      });
    } else {
      caseState = normalizeCaseState(caseState, caseId, userGoal);
    }
    caseState.last_modified_by = user?.user_id || caseState.last_modified_by || null;
    caseState.organization_id = caseState.organization_id || user?.organization_id || null;
    caseState.organization_name = caseState.organization_name || user?.organization_name || null;

    const queues = new DecisionQueues(caseState.queues);
    if (queues.isEmpty() && !caseState.loop?.stop_reason) {
      await this.enqueueAction(queues, "follow_up", defaultActionForStage(caseState.current_stage || 1), caseId);
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
        last_agent_id: action.agent_id,
        risk_state: riskState
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
    await this.events.emit("loop_stopped", {
      case_id: caseId,
      agent_id: "decision_governor",
      output_summary: caseState.loop.stop_reason,
      raw_payload: { stop_reason: caseState.loop.stop_reason, iterations: caseState.loop.iterations }
    });
    await this.caseStore.saveCase(caseState);
    return {
      case_id: caseId,
      stop_reason: caseState.loop.stop_reason,
      case_state: caseState,
      last_result: lastResult
    };
  }

  async enqueueAction(queues, queueName, item, caseId) {
    if (!item) return null;
    const queued = queues.enqueue(queueName, item);
    await this.events.emit("queue_enqueued", {
      case_id: caseId,
      agent_id: "decision_governor",
      input_summary: `Enqueued ${queued.agent_id || queued.type}`,
      raw_payload: { queue: queueName, action: queued }
    });
    return queued;
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
    const requiredEvents = new Set();
    const emit = async (eventType, payload = {}) => {
      await this.events.emit(eventType, payload);
      if (REQUIRED_STAGE_EVENTS.has(eventType)) requiredEvents.add(eventType);
    };

    await emit("agent_start", {
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
    if (output.__system_error) {
      await this.handleSystemError({ caseState, queues, agentId: agent.id, action, error: output });
      const consensus = this.consensus.update(caseState, { agentId: agent.id, output: { confidence: 0, unresolved_tension: output.reason } });
      await emit("state_updated", {
        case_id: caseState.case_id,
        agent_id: agent.id,
        output_summary: output.reason,
        raw_payload: { case_state: caseState }
      });
      await emit("consensus_update", {
        case_id: caseState.case_id,
        agent_id: "consensus_tracker",
        output_summary: `Consensus level: ${consensus.level}`,
        raw_payload: consensus
      });
      await emit("agent_end", {
        case_id: caseState.case_id,
        agent_id: agent.id,
        output_summary: output.reason,
        raw_payload: output
      });
      this.validateRequiredEvents(requiredEvents, agent.id);
      await this.caseStore.saveCase(caseState);
      return { agent_id: agent.id, output, case_state: caseState };
    }

    const toolNames = this.enforceToolFirst(agent, output);
    const toolResults = {};
    for (const toolName of toolNames) {
      toolResults[toolName] = await executeToolWithHooks({
        agentId: agent.id,
        toolName,
        input: { text: userGoal, context: caseState },
        policy: this.policy,
        eventBus: this.events,
        caseId: caseState.case_id
      });
      if (toolResults[toolName]?.status !== "success") {
        await this.handleSystemError({
          caseState,
          queues,
          agentId: agent.id,
          action,
          error: { reason: `Tool ${toolName} failed or was blocked.`, tool_result: toolResults[toolName] }
        });
        break;
      }
    }
    output.tool_results = toolResults;

    await this.updateCaseStateFromAgent(caseState, agent.id, action.stage, output);
    const consensus = this.consensus.update(caseState, { agentId: agent.id, output });
    await emit("state_updated", {
      case_id: caseState.case_id,
      agent_id: agent.id,
      output_summary: `State updated by ${agent.id}`,
      raw_payload: { case_state: caseState }
    });
    await emit("consensus_update", {
      case_id: caseState.case_id,
      agent_id: "consensus_tracker",
      output_summary: `Consensus level: ${consensus.level}`,
      raw_payload: consensus
    });
    await this.events.emit("consensus_updated", {
      case_id: caseState.case_id,
      agent_id: "consensus_tracker",
      output_summary: `Consensus level: ${consensus.level}`,
      raw_payload: consensus
    });
    await this.enqueueFollowUps({ caseState, queues, agentId: agent.id, stage: action.stage, output, action });

    await emit("agent_end", {
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

    this.validateRequiredEvents(requiredEvents, agent.id);
    await this.caseStore.saveCase(caseState);
    return { agent_id: agent.id, output, case_state: caseState };
  }

  async generateAgentOutput({ agent, caseState, userGoal, riskState, sector }) {
    const model = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
    const prompt = [
      `You are ${agent.display_name}: ${agent.role}.`,
      "Return ONLY valid JSON matching schema. Do not include markdown, prose, or commentary.",
      `Output contract: ${schemaPromptFor(agent)}.`,
      "You must request at least one allowed tool through tools_used or tool_calls.",
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
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_JSON_RETRIES; attempt += 1) {
      const result = await this.ai.run(model, {
        messages: [
          { role: "system", content: attempt === 0 ? prompt : `${prompt}\nReturn ONLY valid JSON matching schema.` },
          { role: "user", content: userGoal }
        ],
        max_tokens: 1400
      });
      const parsed = parseModelJson(result?.response || "{}");
      if (!parsed.ok) {
        lastError = parsed.error;
        continue;
      }
      const validation = validateAgentOutput(agent, parsed.value);
      if (!validation.valid) {
        lastError = validation.reason;
        continue;
      }
      return parsed.value;
    }
    return {
      __system_error: true,
      reason: `Invalid JSON or schema after ${MAX_JSON_RETRIES} retries: ${lastError}`,
      agent_id: agent.id
    };
  }

  enforceToolFirst(agent, output) {
    const toolNames = requestedTools(output).filter(Boolean);
    if (toolNames.length > 0) return toolNames;
    const fallbackTool = agent.allowed_tools?.[0];
    if (!fallbackTool) return [];
    output.tools_used = [fallbackTool];
    output.runtime_corrections = [...(output.runtime_corrections || []), "tool_first_default_applied"];
    return [fallbackTool];
  }

  validateRequiredEvents(requiredEvents, agentId) {
    const missing = [...REQUIRED_STAGE_EVENTS].filter((eventType) => !requiredEvents.has(eventType));
    if (missing.length > 0) {
      throw new Error(`Required stage events missing for ${agentId}: ${missing.join(", ")}`);
    }
  }

  async handleSystemError({ caseState, queues, agentId, action, error }) {
    const record = {
      id: crypto.randomUUID(),
      agent_id: agentId,
      source_action: action,
      reason: error.reason || "Agent execution failed.",
      recorded_at: new Date().toISOString(),
      raw_payload: error
    };
    caseState.system_errors = [...(caseState.system_errors || []), record];
    await this.events.emit("system_error", {
      case_id: caseState.case_id,
      agent_id: "decision_governor",
      input_summary: `System error from ${agentId}`,
      output_summary: record.reason,
      raw_payload: record
    });
    if (agentId === "auditor") {
      caseState.status = "escalation_required";
      return null;
    }
    return this.enqueueAction(queues, "steering", {
      type: "agent_turn",
      agent_id: "auditor",
      stage: 3,
      reason: "system_error_forensic_reroute",
      source_agent_id: agentId
    }, caseState.case_id);
  }

  async updateCaseStateFromAgent(caseState, agentId, stage, output) {
    caseState.stage_outputs = { ...(caseState.stage_outputs || {}), [agentId]: output };
    if (stage) caseState.stage_outputs[String(stage)] = output;

    if (agentId === "tracker") {
      const signals = appendUnique(caseState.evidence_bundle?.signals || [], asArray(output.signals));
      caseState.situational_briefing = output.situational_briefing || { verdict: output.verdict || output.finding || "", signals };
      caseState.evidence_bundle = { ...(caseState.evidence_bundle || {}), signals };
    } else if (agentId === "induna") {
      caseState.assumptions = appendUnique(caseState.assumptions || [], output.assumptions || []);
    } else if (agentId === "auditor") {
      caseState.evidence_bundle = mergeObjects(caseState.evidence_bundle || {}, output.evidence || {});
    } else if (agentId === "innovator") {
      caseState.options = appendUnique(caseState.options || [], output.options || []);
      caseState.options_generated = appendUnique(caseState.options_generated || [], output.options || []);
    } else if (agentId === "challenger") {
      caseState.verification_chain.devil_advocate_validated = true;
      const stressTests = output.stress_tests || [];
      const fallbackClaim = output.objection || stressTests.find((item) => item.risk)?.risk || "Key assumption lacks sufficient validation under current risk conditions";
      output.objection = fallbackClaim;
      caseState.devil_advocate_findings = {
        stress_tests: stressTests,
        verdict: output.verdict || output.finding || "",
        confidence: output.confidence
      };
      const objection = this.debate.raiseObjection(caseState, {
        agentId,
        targetAgentId: "innovator",
        claim: fallbackClaim,
        severity: output.severity || "medium",
        confidence: output.confidence || 0.68
      });
      await this.events.emit("objection_raised", {
        case_id: caseState.case_id,
        agent_id: agentId,
        input_summary: `Objection against ${objection.target_agent_id}`,
        output_summary: objection.claim,
        raw_payload: objection
      });
    } else if (agentId === "architect") {
      caseState.implementation_plan = output.implementation_plan || output.plan || {};
      caseState.current_stage = 7;
    } else if (agentId === "guardian") {
      caseState.risk_signals = appendUnique(caseState.risk_signals || [], output.risk_signals || []);
      caseState.monitoring_rules = appendUnique(caseState.monitoring_rules || [], output.monitoring_rules || []);
      caseState.alert_thresholds = appendUnique(caseState.alert_thresholds || [], output.alert_thresholds || []);
    } else if (agentId === "policy_sentinel") {
      const violation = output.policy_violation || output.violation;
      const finalPolicy = this.policy.validateFinalPolicy(caseState);
      caseState.verification_chain.policy_sentinel_validated = !violation && finalPolicy.allowed;
      if (violation || !finalPolicy.allowed) {
        caseState.status = "escalation_required";
        caseState.policy_violations = [
          ...(caseState.policy_violations || []),
          { agent_id: agentId, allowed: false, reason: violation || finalPolicy.reason }
        ];
        await this.events.emit("policy_violation_detected", {
          case_id: caseState.case_id,
          agent_id: "policy_sentinel",
          input_summary: "Final policy validation failed.",
          output_summary: violation || finalPolicy.reason,
          policy_checks: [{ allowed: false, reason: violation || finalPolicy.reason }],
          raw_payload: { violation, final_policy: finalPolicy }
        });
      }
    } else if (agentId === "consensus_tracker") {
      caseState.verification_chain.consensus_tracker_confirmed = output.confirmed !== false;
      if (output.final_rationale) caseState.consensus.final_rationale = output.final_rationale;
    }

    const pipelineStage = stage || stageForAgent(agentId);
    if (pipelineStage && pipelineStage < 6 && agentId !== "challenger") {
      caseState.current_stage = Math.max(Number(caseState.current_stage || 1), pipelineStage + 1);
    }
  }

  async enqueueFollowUps({ caseState, queues, agentId, stage, output, action }) {
    if (action?.reason === "challenge_requires_forensic_recheck") {
      const openObjection = (caseState.objections || []).find((item) => item.status === "open");
      if (openObjection) {
        const rebuttal = this.debate.addRebuttal(caseState, {
          agentId,
          objectionId: openObjection.id,
          response: output.rebuttal || output.finding || "Forensic recheck completed.",
          confidence: output.confidence || 0.74
        });
        await this.events.emit("rebuttal_added", {
          case_id: caseState.case_id,
          agent_id: agentId,
          input_summary: `Rebuttal for ${openObjection.id}`,
          output_summary: rebuttal.response,
          raw_payload: rebuttal
        });
      }
      return this.enqueueAction(queues, "follow_up", {
        type: "agent_turn",
        agent_id: "architect",
        stage: 6,
        reason: "debate_recheck_completed"
      }, caseState.case_id);
    }

    if (agentId === "challenger" && (caseState.objections || []).some((item) => item.status === "open") && this.debate.canContinue(caseState)) {
      const item = await this.enqueueAction(queues, "debate", {
        type: "agent_turn",
        agent_id: "auditor",
        stage: 3,
        reason: "challenge_requires_forensic_recheck"
      }, caseState.case_id);
      return item;
    }

    if (stage && stage < 6) {
      return this.enqueueAction(queues, "follow_up", {
        type: "agent_turn",
        agent_id: getAgentForStage(this.registryDocument, stage + 1).id,
        stage: stage + 1,
        reason: "pipeline_follow_up"
      }, caseState.case_id);
    }

    if (agentId === "architect") {
      return this.enqueueAction(queues, "follow_up", {
        type: "agent_turn",
        agent_id: "guardian",
        stage: 7,
        reason: "monitoring_rules_required_before_decision"
      }, caseState.case_id);
    }

    if (agentId === "guardian") {
      await this.enqueueAction(queues, "follow_up", { type: "agent_turn", agent_id: "policy_sentinel", reason: "final_policy_validation" }, caseState.case_id);
      return this.enqueueAction(queues, "follow_up", { type: "agent_turn", agent_id: "consensus_tracker", reason: "final_consensus_validation" }, caseState.case_id);
    }
    return null;
  }

  checkStopConditions(caseState, queues) {
    if (caseState.status === "escalation_required") return { stop: true, reason: "escalation_required" };
    const preDecision = this.consensus.confirmBeforeDecision(caseState);
    const consensusLevel = CONSENSUS_RANK[caseState.consensus?.level || "unknown"] || 0;
    const hasUnresolvedTensions = (caseState.consensus?.unresolved_tensions || []).length > 0 || (caseState.unresolved_tensions || []).length > 0;
    if (
      preDecision.allowed &&
      queues.isEmpty() &&
      consensusLevel >= CONSENSUS_RANK.medium &&
      !hasUnresolvedTensions
    ) {
      caseState.decision = {
        status: "ready_for_human_approval",
        rationale: caseState.consensus.final_rationale,
        implementation_plan: caseState.implementation_plan
      };
      return { stop: true, reason: "decision_reached" };
    }
    if (queues.isEmpty() && Number(caseState.current_stage || 1) > 6 && consensusLevel < CONSENSUS_RANK.medium) {
      caseState.loop.reevaluation_count = Number(caseState.loop?.reevaluation_count || 0) + 1;
      if (caseState.loop.reevaluation_count <= 3) {
        return { stop: false, reason: "weak_consensus_re_evaluate" };
      }
      caseState.status = "escalation_required";
      return { stop: true, reason: "escalation_required" };
    }
    if (queues.isEmpty() && Number(caseState.current_stage || 1) > 6) return { stop: false, reason: "validation_pending" };
    return { stop: false, reason: null };
  }
}
