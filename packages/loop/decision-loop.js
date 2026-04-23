import { DebateEngine } from "../core/debate-engine.js";
import { ConsensusTracker } from "../core/consensus-tracker.js";
import { EventBus } from "../events/event-bus.js";
import { blendFrameworks } from "../frameworks/framework-blender.js";
import { selectFrameworks } from "../frameworks/framework-selector.js";
import { buildOrganizationalIntelligence } from "../memory/d1-memory-store.js";
import { generateStrategicNarrative } from "../narrative/narrative-engine.js";
import { PolicyEngine } from "../policy/policy-engine.js";
import { PIPELINE_ORDER, getAgent, getAgentForStage } from "../shared/agent-registry.js";
import { executeToolWithHooks, validateToolOutput } from "../skills/index.js";
import { emptyCaseState } from "../state/d1-case-store.js";
import { DecisionQueues } from "./queues.js";

const REQUIRED_STAGE_EVENTS = new Set(["agent_start", "agent_end", "state_updated", "consensus_update"]);
const CONSENSUS_RANK = { unknown: 0, low: 1, medium: 2, high: 3 };
const REQUIRED_D1_TABLES = [
  "decision_cases",
  "audit_events",
  "digital_twin_state",
  "organization_memory",
  "agent_learning_log"
];
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

const AGENT_OUTPUT_CONTRACTS = {
  tracker: {
    required: [
      { key: "evidence", type: "array", nonEmpty: true },
      { key: "confidence", type: "number" }
    ],
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

function compactTrace(value, maxChars = 2400) {
  try {
    const text = JSON.stringify(value);
    if (!text || text.length <= maxChars) return value;
    return { truncated: true, preview: text.slice(0, maxChars) };
  } catch (error) {
    return { unserializable: true, message: error.message };
  }
}

function traceStep(stepName, rawState = {}, rawResult = {}) {
  const state = compactTrace(rawState);
  const result = compactTrace(rawResult);
  console.log("STEP:", stepName, { state, result });
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

function stripPolicyMetadata(output = {}) {
  const { policy_check, after_policy_check, tools_used, ...rest } = output || {};
  return rest;
}

function circuitOpen(caseState = {}, toolName) {
  const breaker = caseState.circuit_breakers?.[toolName];
  if (!breaker?.open_until) return false;
  return Date.parse(breaker.open_until) > Date.now();
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

function normalizeCaseState(caseState, caseId, userGoal) {
  const defaults = emptyCaseState(caseId, userGoal);
  return {
    ...defaults,
    ...caseState,
    evidence_bundle: { ...defaults.evidence_bundle, ...(caseState?.evidence_bundle || {}) },
    framework_selection: { ...defaults.framework_selection, ...(caseState?.framework_selection || {}) },
    frameworks: { ...defaults.frameworks, ...(caseState?.frameworks || {}) },
    analysis: { ...defaults.analysis, ...(caseState?.analysis || {}) },
    framework_outputs: { ...defaults.framework_outputs, ...(caseState?.framework_outputs || {}) },
    blended_analysis: { ...defaults.blended_analysis, ...(caseState?.blended_analysis || {}) },
    narrative: caseState?.narrative || defaults.narrative,
    memory: { ...defaults.memory, ...(caseState?.memory || {}) },
    shared_memory: { ...defaults.shared_memory, ...(caseState?.shared_memory || {}) },
    organizational_intelligence: { ...defaults.organizational_intelligence, ...(caseState?.organizational_intelligence || {}) },
    learning: { ...defaults.learning, ...(caseState?.learning || {}) },
    consensus: { ...defaults.consensus, ...(caseState?.consensus || {}) },
    queues: { ...defaults.queues, ...(caseState?.queues || {}) },
    loop: { ...defaults.loop, ...(caseState?.loop || {}) },
    verification_chain: { ...defaults.verification_chain, ...(caseState?.verification_chain || {}) },
    policy_violations: [...(caseState?.policy_violations || [])],
    revisions: [...(caseState?.revisions || [])]
  };
}

export class DecisionLoop {
  constructor({ registryDocument, caseStore, auditLog, ai, cache = null, memoryStore = null, digitalTwin = null, simulation = null, maxIterations = 12 }) {
    this.registryDocument = registryDocument;
    this.caseStore = caseStore;
    this.auditLog = auditLog;
    this.ai = ai;
    this.cache = cache;
    this.memoryStore = memoryStore;
    this.digitalTwin = digitalTwin;
    this.simulation = simulation;
    this.maxIterations = maxIterations;
    this.policy = new PolicyEngine(registryDocument);
    this.events = new EventBus({ auditLog });
    this.debate = new DebateEngine({ maxRounds: 3 });
    this.consensus = new ConsensusTracker();
  }

  async run({ caseId, userGoal, maxIterations = this.maxIterations, riskState = "ELEVATED", sector = "general", user = null, entryStage = 1, simulationModeEnabled = false }) {
    traceStep("decision_loop.start", { case_id: caseId, user_goal: userGoal, entry_stage: entryStage }, { max_iterations: maxIterations, risk_state: riskState, sector });
    await this.validateSystem({ caseId });
    let caseState = await this.caseStore.getCase(caseId);
    traceStep("decision_loop.case_loaded", { case_id: caseId }, { found: Boolean(caseState), stop_reason: caseState?.loop?.stop_reason || null });
    if (caseState?.organization_id && user?.organization_id && caseState.organization_id !== user.organization_id) {
      throw new Error("Case not found for organization.");
    }
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

    if (caseState.loop?.stop_reason) {
      traceStep("decision_loop.loop_stopped.return_final", caseState, { stop_reason: caseState.loop.stop_reason });
      return {
        case_id: caseId,
        stop_reason: caseState.loop.stop_reason,
        organizational_intelligence: caseState.organizational_intelligence,
        case_state: caseState,
        last_result: null
      };
    }

    caseState.simulation_mode_enabled = Boolean(simulationModeEnabled || caseState.simulation_mode_enabled);
    caseState.digital_twin = await this.retrieveDigitalTwin({ caseState, caseId, user });
    caseState.shared_memory = await this.retrieveMemory({ caseState, caseId, userGoal, user });
    caseState.memory = caseState.shared_memory;
    caseState.organizational_intelligence = caseState.shared_memory.organizational_intelligence || buildOrganizationalIntelligence(caseState.shared_memory);
    caseState.framework_selection = await this.selectFrameworksForCase({ caseState, caseId, userGoal });

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
      traceStep("decision_loop.iteration_start", caseState, { iteration: i + 1, queues: queues.snapshot() });
      const next = queues.dequeueNext() || this.selectNextAction(caseState);
      if (!next?.item && !next?.agent_id) {
        stopReason = "no_progress";
        traceStep("decision_loop.no_next_action", caseState, { stop_reason: stopReason });
        break;
      }

      const action = next.item || next;
      traceStep("state_to_next_agent", caseState, { action, queue: next.queue || "governor" });
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
      if (caseState.status === "critical_failure") {
        stopReason = "critical_tool_failure";
        traceStep("decision_loop.critical_failure_stop", caseState, { stop_reason: stopReason });
        break;
      }
      caseState.queues = queues.snapshot();
      caseState.loop = {
        ...(caseState.loop || {}),
        iterations: Number(caseState.loop?.iterations || 0) + 1,
        max_iterations: maxIterations,
        last_agent_id: action.agent_id,
        risk_state: riskState,
        progress_signature: this.progressSignature(caseState, queues)
      };

      if (caseState.simulation_mode_enabled) {
        await this.runSimulationBeforeDecision({ caseState, queues, userGoal, user });
      }

      const stopCheck = this.checkStopConditions(caseState, queues);
      traceStep("decision_loop.stop_check", caseState, stopCheck);
      if (stopCheck.stop) {
        stopReason = stopCheck.reason;
        break;
      }
      if (this.detectLoopStall(caseState, queues)) {
        stopReason = "loop_stalled";
        caseState.status = "escalation_required";
        traceStep("decision_loop.stall_detected", caseState, { stop_reason: stopReason });
        break;
      }
    }

    caseState.loop = { ...(caseState.loop || {}), stop_reason: stopReason || "max_iterations" };
    traceStep("decision_loop.termination", caseState, { stop_reason: caseState.loop.stop_reason });
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
    } else if (caseState.loop.stop_reason === "critical_tool_failure") {
      caseState.status = "critical_failure";
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
    await this.persistMemory({ caseState, userGoal, user });
    await this.persistDigitalTwinFeedback({ caseState, user });
    caseState.organizational_intelligence = buildOrganizationalIntelligence(caseState.shared_memory || caseState.memory || {});
    await this.generateNarrative({ caseState });
    await this.caseStore.saveCase(caseState);
    return {
      case_id: caseId,
      stop_reason: caseState.loop.stop_reason,
      organizational_intelligence: caseState.organizational_intelligence,
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

  progressSignature(caseState, queues) {
    return JSON.stringify({
      stage: caseState.current_stage,
      status: caseState.status,
      queues: queues.snapshot(),
      verification_chain: caseState.verification_chain,
      output_agents: Object.keys(caseState.stage_outputs || {}).sort(),
      consensus_level: caseState.consensus?.level || "unknown"
    });
  }

  detectLoopStall(caseState, queues) {
    const signature = this.progressSignature(caseState, queues);
    const lastSignature = caseState.loop?.last_progress_signature;
    const stallCount = signature === lastSignature ? Number(caseState.loop?.stall_count || 0) + 1 : 0;
    caseState.loop = {
      ...(caseState.loop || {}),
      last_progress_signature: signature,
      stall_count: stallCount
    };
    return stallCount >= 2;
  }

  async validateSystem({ caseId }) {
    traceStep("validate_system.start", { case_id: caseId }, { required_tables: REQUIRED_D1_TABLES });
    try {
      if (this.cache?.put) {
        const key = `case:${caseId || "healthcheck"}`;
        const safeKey = new TextEncoder().encode(key).length < 512 ? key : `case:${crypto.randomUUID()}`;
        await this.cache.put(safeKey, JSON.stringify({ ok: true }), { expirationTtl: 60 });
        traceStep("validate_system.kv", { case_id: caseId, key: safeKey }, { ok: true, key_bytes: new TextEncoder().encode(safeKey).length });
      }
      if (this.caseStore?.db?.prepare) {
        await this.caseStore.db.prepare("SELECT 1").run();
        for (const table of REQUIRED_D1_TABLES) {
          await this.caseStore.db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).first();
        }
        traceStep("validate_system.d1", { case_id: caseId }, { ok: true, tables: REQUIRED_D1_TABLES });
      }
      traceStep("validate_system.end", { case_id: caseId }, { ok: true });
      return true;
    } catch (error) {
      traceStep("validate_system.error", { case_id: caseId }, { error: error.message });
      try {
        await this.events.emit("system_error", {
          case_id: caseId,
          agent_id: "decision_governor",
          input_summary: "Infrastructure validation failed before decision loop.",
          output_summary: error.message,
          raw_payload: { error: error.message }
        });
      } catch (emitError) {
        console.error("STEP:", "validate_system.audit_error", { state: { case_id: caseId }, result: { error: emitError.message } });
      }
      throw new Error(`INFRASTRUCTURE VALIDATION FAILED: ${error.message}`);
    }
  }

  async retrieveMemory({ caseState, caseId, userGoal, user }) {
    const emptyMemory = { episodic: [], semantic: [], procedural: [], retrieval: { strategy: "memory_store_unavailable" } };
    if (!this.memoryStore) return caseState.memory || emptyMemory;
    try {
      traceStep("memory.retrieve.start", caseState, { case_id: caseId });
      const memory = await this.memoryStore.retrieve({ caseId, userGoal, user, caseState });
      traceStep("memory.retrieve.end", caseState, {
        episodic: memory.episodic.length,
        semantic: memory.semantic.length,
        procedural: memory.procedural.length
      });
      await this.events.emit("memory_retrieved", {
        case_id: caseId,
        agent_id: "decision_governor",
        input_summary: "Retrieved memory before decision loop.",
        output_summary: `${memory.episodic.length} episodic, ${memory.semantic.length} semantic, ${memory.procedural.length} procedural memories.`,
        raw_payload: memory
      });
      return memory;
    } catch (error) {
      traceStep("memory.retrieve.error", caseState, { error: error.message });
      await this.events.emit("system_error", {
        case_id: caseId,
        agent_id: "decision_governor",
        input_summary: "Memory retrieval failed.",
        output_summary: error.message,
        raw_payload: { error: error.message }
      });
      return caseState.memory || emptyMemory;
    }
  }

  async selectFrameworksForCase({ caseState, caseId, userGoal }) {
    traceStep("framework_selection.start", caseState, { case_id: caseId });
    const selection = await selectFrameworks({
      ...caseState,
      case_description: caseState.case_description || userGoal || caseState.user_goal
    }, { ai: caseState.framework_selector_llm_enabled ? this.ai : null });
    traceStep("framework_selection.end", caseState, selection);
    await this.events.emit("framework_selected", {
      case_id: caseId,
      agent_id: "framework_selector",
      input_summary: "Selected strategic frameworks for decision reasoning.",
      output_summary: `${selection.primary_framework}: ${selection.justification}`,
      raw_payload: selection
    });
    return selection;
  }

  async retrieveDigitalTwin({ caseState, caseId, user }) {
    if (!this.digitalTwin?.getLatestTwinState) return caseState.digital_twin || null;
    const organizationId = user?.organization_id || caseState.organization_id;
    if (!organizationId) return caseState.digital_twin || null;
    try {
      traceStep("digital_twin.load.start", caseState, { organization_id: organizationId });
      let digitalTwin = await this.digitalTwin.getLatestTwinState({ organizationId, caseState });
      if (!digitalTwin && this.digitalTwin.refreshTwinState) {
        traceStep("digital_twin.refresh.start", caseState, { organization_id: organizationId });
        const refreshed = await this.digitalTwin.refreshTwinState({ organizationId, caseState });
        digitalTwin = Array.isArray(refreshed?.updated) ? refreshed.updated[0] : refreshed;
        traceStep("digital_twin.refresh.end", caseState, { loaded: Boolean(digitalTwin), digital_twin: digitalTwin });
      }
      traceStep("digital_twin.load.end", caseState, { loaded: Boolean(digitalTwin), risk_state: digitalTwin?.risk_state || null });
      await this.events.emit("state_update", {
        case_id: caseId,
        agent_id: "digital_twin_engine",
        input_summary: "Digital twin loaded before decision loop.",
        output_summary: `Twin risk level: ${digitalTwin?.risk_state?.level || "unavailable"}`,
        raw_payload: {
          organization_id: organizationId,
          digital_twin: digitalTwin
        }
      });
      return digitalTwin;
    } catch (error) {
      traceStep("digital_twin.load.error", caseState, { error: error.message });
      await this.events.emit("system_error", {
        case_id: caseId,
        agent_id: "digital_twin_engine",
        input_summary: "Digital twin retrieval failed.",
        output_summary: error.message,
        raw_payload: { error: error.message }
      });
      return caseState.digital_twin || null;
    }
  }

  async persistMemory({ caseState, userGoal, user }) {
    if (!this.memoryStore) return null;
    const outcome = caseState.status === "escalation_required" || caseState.consensus?.level === "low" ? "failure" : "success";
    try {
      traceStep("memory.write.start", caseState, { outcome });
      const input = {
        text: userGoal,
        context: caseState,
        llm: this.ai,
        cache: this.cache
      };
      const managed = await executeToolWithHooks({
        agentId: "decision_governor",
        toolName: "manage_memory",
        input,
        policy: this.policy,
        eventBus: this.events,
        caseId: caseState.case_id
      });
      const memory = managed.memory || {};
      const reflection = managed.reflection || {};
      const learning = managed.learning || {};
      validateToolOutput(managed);
      validateToolOutput(memory);
      validateToolOutput(reflection);
      validateToolOutput(learning);
      caseState.reflection = reflection;
      caseState.learning = learning;
      await this.memoryStore.remember({ caseState, memory, reflection, learning, user, outcome });
      await this.events.emit("reflection_completed", {
        case_id: caseState.case_id,
        agent_id: "decision_governor",
        input_summary: "Decision reflection completed.",
        output_summary: summarize(reflection),
        raw_payload: reflection
      });
      await this.events.emit("learning_extracted", {
        case_id: caseState.case_id,
        agent_id: "decision_governor",
        input_summary: "Cross-agent learning extracted.",
        output_summary: summarize(learning),
        raw_payload: learning
      });
      await this.events.emit("memory_written", {
        case_id: caseState.case_id,
        agent_id: "decision_governor",
        input_summary: "Decision memory written.",
        output_summary: `Memory stored with ${outcome} outcome.`,
        raw_payload: { outcome, memory, learning }
      });
      traceStep("memory.write.end", caseState, { outcome, memory, learning });
      return memory;
    } catch (error) {
      traceStep("memory.write.error", caseState, { error: error.message });
      await this.events.emit("system_error", {
        case_id: caseState.case_id,
        agent_id: "decision_governor",
        input_summary: "Memory write failed.",
        output_summary: error.message,
        raw_payload: { error: error.message }
      });
      return null;
    }
  }

  async persistDigitalTwinFeedback({ caseState, user }) {
    if (!this.digitalTwin?.updateDecisionOutcome) return null;
    const organizationId = user?.organization_id || caseState.organization_id;
    if (!organizationId) return null;
    const outcome = caseState.status === "escalation_required" || caseState.consensus?.level === "low" ? "failure" : "success";
    try {
      traceStep("digital_twin.feedback.start", caseState, { organization_id: organizationId, outcome });
      const digitalTwin = await this.digitalTwin.updateDecisionOutcome({ organizationId, caseState, outcome });
      caseState.digital_twin = digitalTwin;
      traceStep("digital_twin.feedback.end", caseState, { organization_id: organizationId, digital_twin: digitalTwin });
      await this.events.emit("state_update", {
        case_id: caseState.case_id,
        agent_id: "digital_twin_engine",
        input_summary: "Digital twin feedback updated after decision loop.",
        output_summary: `Twin risk level: ${digitalTwin?.risk_state?.level || "unknown"}`,
        raw_payload: { organization_id: organizationId, outcome, digital_twin: digitalTwin }
      });
      return digitalTwin;
    } catch (error) {
      traceStep("digital_twin.feedback.error", caseState, { organization_id: organizationId, error: error.message });
      await this.events.emit("system_error", {
        case_id: caseState.case_id,
        agent_id: "digital_twin_engine",
        input_summary: "Digital twin feedback update failed.",
        output_summary: error.message,
        raw_payload: { error: error.message }
      });
      return null;
    }
  }

  async generateNarrative({ caseState }) {
    traceStep("narrative.start", caseState, { mode: caseState.narrative_mode || "board" });
    const narrative = generateStrategicNarrative(caseState, caseState.narrative_mode || "board");
    caseState.narrative = narrative;
    traceStep("narrative.end", caseState, narrative);
    await this.events.emit("narrative_generated", {
      case_id: caseState.case_id,
      agent_id: "narrative_engine",
      input_summary: "Strategic narrative generated after decision loop.",
      output_summary: narrative.recommended_action,
      raw_payload: {
        inputs_used: {
          blended_frameworks: Boolean(caseState.blended_analysis?.recommended_strategy),
          simulation_results: Boolean(caseState.simulation),
          digital_twin_state: Boolean(caseState.digital_twin),
          risk_state: caseState.risk_state || caseState.loop?.risk_state,
          recommended_strategy: caseState.decision?.recommended_strategy || caseState.recommended_strategy || null
        },
        recommendation_alignment: narrative.recommended_action === (caseState.decision?.recommended_strategy || caseState.recommended_strategy)
          ? "aligned"
          : "derived_from_available_strategy",
        narrative
      }
    });
    return narrative;
  }

  async runSimulationBeforeDecision({ caseState, queues, userGoal, user }) {
    if (caseState.simulation?.generated_at || !this.simulation?.runSimulation) return null;
    if (!queues.isEmpty()) return null;
    const preDecision = this.consensus.confirmBeforeDecision(caseState);
    const consensusLevel = CONSENSUS_RANK[caseState.consensus?.level || "unknown"] || 0;
    const hasUnresolvedTensions = (caseState.consensus?.unresolved_tensions || []).length > 0 || (caseState.unresolved_tensions || []).length > 0;
    if (!preDecision.allowed || consensusLevel < CONSENSUS_RANK.medium || hasUnresolvedTensions) return null;

    traceStep("simulation.start", caseState, { user_goal: userGoal });
    const simulationResult = await this.simulation.runSimulation({
      ...caseState,
      user_goal: userGoal || caseState.user_goal,
      user
    });
    caseState.simulation = simulationResult;
    if (simulationResult.best_strategy) {
      caseState.recommended_strategy = simulationResult.best_strategy;
    }
    await this.events.emit("simulation_completed", {
      case_id: caseState.case_id,
      agent_id: "simulation_engine",
      input_summary: "Simulation completed before final decision.",
      output_summary: simulationResult.justification,
      raw_payload: simulationResult
    });

    if (simulationResult.block_execution) {
      caseState.status = "awaiting_approval";
      caseState.simulation_block = {
        reason: "Simulation risk score exceeded governance threshold.",
        risk_threshold: simulationResult.risk_threshold,
        highest_risk_score: simulationResult.highest_risk_score,
        recorded_at: new Date().toISOString()
      };
      if (!(caseState.approval_gates || []).some((gate) => gate.type === "simulation_risk" && gate.status === "pending")) {
        caseState.approval_gates = [
          ...(caseState.approval_gates || []),
          {
            approval_id: crypto.randomUUID(),
            type: "simulation_risk",
            stage_id: Number(caseState.current_stage || 7),
            agent_id: "simulation_engine",
            status: "pending",
            requested_at: new Date().toISOString(),
            reason: caseState.simulation_block.reason
          }
        ];
      }
    }
    traceStep("simulation.end", caseState, simulationResult);
    return simulationResult;
  }

  selectNextAction(caseState) {
    let action = null;
    if (caseState.status === "awaiting_approval") {
      traceStep("select_next_action", caseState, { action: null, reason: "awaiting_approval" });
      return null;
    }
    if (caseState.current_stage && caseState.current_stage <= 6) {
      action = defaultActionForStage(caseState.current_stage);
      traceStep("select_next_action", caseState, { action });
      return action;
    }
    if (!caseState.verification_chain?.policy_sentinel_validated) {
      action = { type: "agent_turn", agent_id: "policy_sentinel", reason: "pre_decision_policy_validation" };
      traceStep("select_next_action", caseState, { action });
      return action;
    }
    if (!caseState.verification_chain?.consensus_tracker_confirmed) {
      action = { type: "agent_turn", agent_id: "consensus_tracker", reason: "pre_decision_consensus_validation" };
      traceStep("select_next_action", caseState, { action });
      return action;
    }
    traceStep("select_next_action", caseState, { action: null, reason: "no_action" });
    return null;
  }

  async executeAgentTurn({ caseState, queues, action, userGoal, riskState, sector }) {
    const agent = getAgent(this.registryDocument, action.agent_id);
    if (!agent) throw new Error(`Unknown loop agent: ${action.agent_id}`);
    traceStep("agent.start", caseState, { agent_id: agent.id, action });
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

    let output;
    let toolName;
    let toolResults;
    try {
      traceStep("agent.tool_call.start", caseState, { agent_id: agent.id });
      ({ output, toolName, toolResults } = await this.executeAgentTool({
        agent,
        caseState,
        userGoal,
        riskState,
        sector
      }));
      traceStep("agent.tool_call.end", caseState, { agent_id: agent.id, tool_name: toolName, output });
    } catch (error) {
      toolName = AGENT_TOOL_MAP[agent.id] || agent.allowed_tools?.[0] || null;
      toolResults = {};
      output = {
        __system_error: true,
        reason: error.message.includes("CRITICAL TOOL FAILURE") ? error.message : `CRITICAL TOOL FAILURE: ${error.message}`,
        agent_id: agent.id
      };
      traceStep("agent.tool_call.error", caseState, { agent_id: agent.id, tool_name: toolName, error: error.message });
    }
    if (output.__system_error) {
      await this.handleCriticalToolFailure({ caseState, agentId: agent.id, action, error: output });
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
      traceStep("agent.end", caseState, { agent_id: agent.id, tool_name: toolName, status: "critical_failure" });
      return { agent_id: agent.id, output, case_state: caseState };
    }

    output.tool_results = toolResults;

    caseState = await this.mergeState(caseState, { agentId: agent.id, stage: action.stage, output });
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
      tools_used: [toolName],
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
    traceStep("agent.end", caseState, { agent_id: agent.id, tool_name: toolName });
    return { agent_id: agent.id, output, case_state: caseState };
  }

  toolInput({ caseState, userGoal, riskState, sector }) {
    return {
      text: userGoal,
      context: {
        ...caseState,
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
    };
  }

  recordToolSuccess(caseState, toolName) {
    if (!toolName) return;
    caseState.circuit_breakers = { ...(caseState.circuit_breakers || {}) };
    delete caseState.circuit_breakers[toolName];
  }

  recordToolFailure(caseState, toolName, error) {
    if (!toolName) return;
    const previous = caseState.circuit_breakers?.[toolName] || {};
    const failures = Number(previous.failures || 0) + 1;
    caseState.circuit_breakers = {
      ...(caseState.circuit_breakers || {}),
      [toolName]: {
        failures,
        last_error: error.message,
        open_until: failures >= 2 ? new Date(Date.now() + 60000).toISOString() : null
      }
    };
  }

  async executeAgentTool({ agent, caseState, userGoal, riskState, sector }) {
    const toolName = AGENT_TOOL_MAP[agent.id] || agent.allowed_tools?.[0];
    if (!toolName) {
      return {
        toolName: null,
        toolResults: {},
        output: {
          __system_error: true,
          reason: `No governed tool mapped for ${agent.id}.`,
          agent_id: agent.id
        }
      };
    }
    if (circuitOpen(caseState, toolName)) {
      throw new Error(`CRITICAL TOOL FAILURE: Circuit breaker open for ${toolName}.`);
    }

    let frameworkResults = {};
    try {
      frameworkResults = await this.executeFrameworkTools({ agent, caseState, userGoal, riskState, sector });
    } catch (error) {
      throw new Error(`CRITICAL TOOL FAILURE: Framework reasoning failed for ${agent.id}: ${error.message}`);
    }

    try {
      traceStep("tool.execution.start", caseState, { agent_id: agent.id, tool_name: toolName });
      const result = await executeToolWithHooks({
        agentId: agent.id,
        toolName,
        input: this.toolInput({ caseState, userGoal, riskState, sector }),
        policy: this.policy,
        eventBus: this.events,
        caseId: caseState.case_id
      });
      if (result?.status === "blocked" || result?.status === "error" || result?.error) {
        throw new Error(result.message || `Tool ${toolName} failed or was blocked.`);
      }
      validateToolOutput(result);
      const validation = validateAgentOutput(agent, result);
      if (!validation.valid) {
        throw new Error(validation.reason);
      }
      this.recordToolSuccess(caseState, toolName);
      traceStep("tool.execution.end", caseState, { agent_id: agent.id, tool_name: toolName, result });
      return {
        toolName,
        toolResults: { ...frameworkResults, [toolName]: { ...result } },
        output: {
          ...result,
          frameworks: caseState.frameworks || {},
          analysis: caseState.analysis || {}
        }
      };
    } catch (error) {
      this.recordToolFailure(caseState, toolName, error);
      traceStep("tool.execution.error", caseState, { agent_id: agent.id, tool_name: toolName, error: error.message });
      throw new Error(`CRITICAL TOOL FAILURE: Tool ${toolName} failed: ${error.message}`);
    }
  }

  async executeFrameworkTools({ agent, caseState, userGoal, riskState, sector }) {
    const frameworkTools = this.frameworkToolsForAgent(caseState, agent.id);
    const results = {};
    const executions = frameworkTools.map(async (frameworkTool) => {
      if (circuitOpen(caseState, frameworkTool)) {
        return { frameworkTool, skipped: true, reason: `Circuit breaker open for ${frameworkTool}.` };
      }
      traceStep("framework_tool.execution.start", caseState, { agent_id: agent.id, tool_name: frameworkTool });
      try {
        const result = await executeToolWithHooks({
          agentId: agent.id,
          toolName: frameworkTool,
          input: this.toolInput({ caseState, userGoal, riskState, sector }),
          policy: this.policy,
          eventBus: this.events,
          caseId: caseState.case_id
        });
        if (result?.status === "blocked" || result?.status === "error" || result?.error) {
          throw new Error(result.message || `Framework tool ${frameworkTool} failed or was blocked.`);
        }
        validateToolOutput(result);
        this.recordToolSuccess(caseState, frameworkTool);
        traceStep("framework_tool.execution.end", caseState, { agent_id: agent.id, tool_name: frameworkTool, result });
        return { frameworkTool, result };
      } catch (error) {
        this.recordToolFailure(caseState, frameworkTool, error);
        traceStep("framework_tool.execution.error", caseState, { agent_id: agent.id, tool_name: frameworkTool, error: error.message });
        await this.events.emit("system_error", {
          case_id: caseState.case_id,
          agent_id: agent.id,
          input_summary: `Framework tool failed: ${frameworkTool}`,
          output_summary: error.message,
          tools_used: [frameworkTool],
          raw_payload: { tool: frameworkTool, error: error.message }
        });
        return { frameworkTool, error };
      }
    });
    const settled = await Promise.all(executions);
    for (const item of settled) {
      if (!item?.result) continue;
      this.mergeFrameworkOutput(caseState, item.frameworkTool, item.result);
      results[item.frameworkTool] = { ...item.result };
    }
    return results;
  }

  frameworkToolsForAgent(caseState, agentId) {
    if (agentId === "induna" || agentId === "policy_sentinel" || agentId === "consensus_tracker") return [];
    const agent = getAgent(this.registryDocument, agentId);
    const selected = caseState.framework_selection?.tool_names || [];
    const fallback = ["run_swot_analysis", "run_scenario_planning"];
    const tools = selected.length ? selected : fallback;
    return tools.filter((toolName) => {
      const mapping = FRAMEWORK_STATE_MAP[toolName];
      return mapping && agent?.allowed_tools?.includes(toolName) && !caseState.frameworks?.[mapping.framework];
    });
  }

  mergeFrameworkOutput(caseState, toolName, output) {
    const mapping = FRAMEWORK_STATE_MAP[toolName];
    if (!mapping) return null;
    const structured = stripPolicyMetadata(output);
    caseState.frameworks = {
      ...(caseState.frameworks || {}),
      [mapping.framework]: structured
    };
    caseState.framework_outputs = {
      ...(caseState.framework_outputs || {}),
      [mapping.framework === "scenario_planning" ? "scenario" : mapping.framework]: structured
    };
    caseState.analysis = {
      ...(caseState.analysis || {}),
      [mapping.analysis]: structured
    };
    caseState.blended_analysis = blendFrameworks(caseState.framework_outputs);
    return structured;
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

  async handleCriticalToolFailure({ caseState, agentId, action, error }) {
    const record = {
      id: crypto.randomUUID(),
      agent_id: agentId,
      source_action: action,
      reason: `CRITICAL TOOL FAILURE: ${error.reason || error.message || "Tool failed after retries."}`,
      recorded_at: new Date().toISOString(),
      raw_payload: error
    };
    caseState.status = "critical_failure";
    caseState.critical_failure = record;
    caseState.system_errors = [...(caseState.system_errors || []), record];
    caseState.queues = { steering: [], follow_up: [], debate: [] };
    await this.events.emit("system_error", {
      case_id: caseState.case_id,
      agent_id: "decision_governor",
      input_summary: `Critical tool failure from ${agentId}`,
      output_summary: record.reason,
      raw_payload: record
    });
    return null;
  }

  async mergeState(caseState, { agentId, stage, output }) {
    await this.updateCaseStateFromAgent(caseState, agentId, stage, output);
    traceStep("result_to_state_update", caseState, {
      agent_id: agentId,
      stage,
      output_summary: summarize(output)
    });
    return caseState;
  }

  async updateCaseStateFromAgent(caseState, agentId, stage, output) {
    caseState.stage_outputs = { ...(caseState.stage_outputs || {}), [agentId]: output };
    if (stage) caseState.stage_outputs[String(stage)] = output;

    if (agentId === "tracker") {
      const signals = appendUnique(caseState.evidence_bundle?.signals || [], asArray(output.signals));
      const evidence = appendUnique(caseState.evidence_bundle?.evidence || [], asArray(output.evidence));
      caseState.situational_briefing = output.situational_briefing || { verdict: output.verdict || output.finding || "", signals };
      caseState.evidence_bundle = { ...(caseState.evidence_bundle || {}), signals, evidence };
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
      if (!Array.isArray(output.objections) || output.objections.length === 0) {
        output.objections = [
          {
            id: "obj_fallback",
            text: "Critical assumptions lack adversarial validation",
            severity: "high"
          }
        ];
      }
      const fallbackClaim = output.objection || output.objections[0]?.text || stressTests.find((item) => item.risk)?.risk || "Key assumption lacks sufficient validation under current risk conditions";
      output.objection = fallbackClaim;
      caseState.devil_advocate_findings = {
        objections: output.objections,
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
    if (caseState.status === "awaiting_approval") return { stop: true, reason: "human_approval_required" };
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
        rationale: caseState.simulation?.best_strategy
          ? `${caseState.consensus.final_rationale} Simulation selected: ${caseState.simulation.best_strategy}.`
          : caseState.consensus.final_rationale,
        recommended_strategy: caseState.simulation?.best_strategy || caseState.recommended_strategy || null,
        implementation_plan: caseState.implementation_plan,
        simulation: caseState.simulation || null,
        organizational_intelligence: caseState.organizational_intelligence || buildOrganizationalIntelligence(caseState.shared_memory || caseState.memory || {})
      };
      return { stop: true, reason: "decision_reached" };
    }
    if (queues.isEmpty() && Number(caseState.current_stage || 1) > 6 && consensusLevel < CONSENSUS_RANK.medium) {
      caseState.loop.reevaluation_count = Number(caseState.loop?.reevaluation_count || 0) + 1;
      caseState.status = "escalation_required";
      return { stop: true, reason: "weak_consensus_fail_fast" };
    }
    if (queues.isEmpty() && Number(caseState.current_stage || 1) > 6) {
      caseState.status = "escalation_required";
      return { stop: true, reason: "validation_pending_fail_fast" };
    }
    return { stop: false, reason: null };
  }
}
