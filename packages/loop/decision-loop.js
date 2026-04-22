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

const MAX_TOOL_ATTEMPTS = 2;
const REQUIRED_STAGE_EVENTS = new Set(["agent_start", "agent_end", "state_updated", "consensus_update"]);
const CONSENSUS_RANK = { unknown: 0, low: 1, medium: 2, high: 3 };
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
    await this.validateSystem({ caseId });
    let caseState = await this.caseStore.getCase(caseId);
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
      if (caseState.status === "critical_failure") {
        stopReason = "critical_tool_failure";
        break;
      }
      caseState.queues = queues.snapshot();
      caseState.loop = {
        ...(caseState.loop || {}),
        iterations: Number(caseState.loop?.iterations || 0) + 1,
        max_iterations: maxIterations,
        last_agent_id: action.agent_id,
        risk_state: riskState
      };

      if (caseState.simulation_mode_enabled) {
        await this.runSimulationBeforeDecision({ caseState, queues, userGoal, user });
      }

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

  async validateSystem({ caseId }) {
    try {
      if (this.cache?.put) {
        await this.cache.put("healthcheck", "ok", { expirationTtl: 60 });
      }
      if (this.caseStore?.db?.prepare) {
        await this.caseStore.db.prepare("SELECT 1").run();
      }
      return true;
    } catch (error) {
      await this.events.emit("system_error", {
        case_id: caseId,
        agent_id: "decision_governor",
        input_summary: "Infrastructure validation failed before decision loop.",
        output_summary: error.message,
        raw_payload: { error: error.message }
      });
      throw new Error(`INFRASTRUCTURE VALIDATION FAILED: ${error.message}`);
    }
  }

  async retrieveMemory({ caseState, caseId, userGoal, user }) {
    const emptyMemory = { episodic: [], semantic: [], procedural: [], retrieval: { strategy: "memory_store_unavailable" } };
    if (!this.memoryStore) return caseState.memory || emptyMemory;
    try {
      const memory = await this.memoryStore.retrieve({ caseId, userGoal, user, caseState });
      await this.events.emit("memory_retrieved", {
        case_id: caseId,
        agent_id: "decision_governor",
        input_summary: "Retrieved memory before decision loop.",
        output_summary: `${memory.episodic.length} episodic, ${memory.semantic.length} semantic, ${memory.procedural.length} procedural memories.`,
        raw_payload: memory
      });
      return memory;
    } catch (error) {
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
    const selection = await selectFrameworks({
      ...caseState,
      case_description: caseState.case_description || userGoal || caseState.user_goal
    }, { ai: caseState.framework_selector_llm_enabled ? this.ai : null });
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
      const digitalTwin = await this.digitalTwin.getLatestTwinState({ organizationId, caseState });
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
      const input = {
        text: userGoal,
        context: caseState,
        llm: this.ai,
        cache: this.cache
      };
      const memory = await executeToolWithHooks({
        agentId: "decision_governor",
        toolName: "extract_memory",
        input,
        policy: this.policy,
        eventBus: this.events,
        caseId: caseState.case_id
      });
      const reflection = await executeToolWithHooks({
        agentId: "decision_governor",
        toolName: "reflect_on_decision",
        input,
        policy: this.policy,
        eventBus: this.events,
        caseId: caseState.case_id
      });
      const learning = await executeToolWithHooks({
        agentId: "decision_governor",
        toolName: "extract_learning",
        input,
        policy: this.policy,
        eventBus: this.events,
        caseId: caseState.case_id
      });
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
      return memory;
    } catch (error) {
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
      const digitalTwin = await this.digitalTwin.updateDecisionOutcome({ organizationId, caseState, outcome });
      caseState.digital_twin = digitalTwin;
      await this.events.emit("state_update", {
        case_id: caseState.case_id,
        agent_id: "digital_twin_engine",
        input_summary: "Digital twin feedback updated after decision loop.",
        output_summary: `Twin risk level: ${digitalTwin?.risk_state?.level || "unknown"}`,
        raw_payload: { organization_id: organizationId, outcome, digital_twin: digitalTwin }
      });
      return digitalTwin;
    } catch (error) {
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
    const narrative = generateStrategicNarrative(caseState, caseState.narrative_mode || "board");
    caseState.narrative = narrative;
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
    return simulationResult;
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

    let output;
    let toolName;
    let toolResults;
    try {
      ({ output, toolName, toolResults } = await this.executeAgentTool({
        agent,
        caseState,
        userGoal,
        riskState,
        sector
      }));
    } catch (error) {
      toolName = AGENT_TOOL_MAP[agent.id] || agent.allowed_tools?.[0] || null;
      toolResults = {};
      output = {
        __system_error: true,
        reason: error.message.includes("CRITICAL TOOL FAILURE") ? error.message : `CRITICAL TOOL FAILURE: ${error.message}`,
        agent_id: agent.id
      };
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
      return { agent_id: agent.id, output, case_state: caseState };
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
    return { agent_id: agent.id, output, case_state: caseState };
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

    let frameworkResults = {};
    try {
      frameworkResults = await this.executeFrameworkTools({ agent, caseState, userGoal, riskState, sector });
    } catch (error) {
      throw new Error(`CRITICAL TOOL FAILURE: Framework reasoning failed for ${agent.id}: ${error.message}`);
    }

    let lastError = null;
    for (let attempt = 1; attempt <= MAX_TOOL_ATTEMPTS; attempt += 1) {
      try {
        const result = await executeToolWithHooks({
          agentId: agent.id,
          toolName,
          input: {
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
          },
          policy: this.policy,
          eventBus: this.events,
          caseId: caseState.case_id
        });
        if (result?.status === "blocked" || result?.status === "error") {
          lastError = result.message || `Tool ${toolName} failed or was blocked.`;
          continue;
        }
        validateToolOutput(result);
        const validation = validateAgentOutput(agent, result);
        if (!validation.valid) {
          lastError = validation.reason;
          continue;
        }
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
        lastError = error.message;
        continue;
      }
    }
    throw new Error(`CRITICAL TOOL FAILURE: Tool ${toolName} failed after ${MAX_TOOL_ATTEMPTS} attempts: ${lastError}`);
  }

  async executeFrameworkTools({ agent, caseState, userGoal, riskState, sector }) {
    const frameworkTools = this.frameworkToolsForAgent(caseState, agent.id);
    const results = {};
    for (const frameworkTool of frameworkTools) {
      const result = await executeToolWithHooks({
        agentId: agent.id,
        toolName: frameworkTool,
        input: {
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
        },
        policy: this.policy,
        eventBus: this.events,
        caseId: caseState.case_id
      });
      if (result?.status === "blocked" || result?.status === "error") {
        throw new Error(result.message || `Framework tool ${frameworkTool} failed or was blocked.`);
      }
      validateToolOutput(result);
      this.mergeFrameworkOutput(caseState, frameworkTool, result);
      results[frameworkTool] = { ...result };
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
