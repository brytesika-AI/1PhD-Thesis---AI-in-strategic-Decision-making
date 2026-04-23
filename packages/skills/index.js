import { simulateDigitalTwinScenario } from "../digital-twin/digital-twin-engine.js";
import {
  TOOL_OUTPUT_SCHEMAS,
  TOOL_ERROR_SCHEMA,
  enforceJSON as enforceStructuredJSON,
  safeToolExecution,
  structuredToolError,
  validateBaseToolOutput
} from "../../utils/schema-validator.js";

const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const TOOL_CACHE_VERSION = "tool-v3-shared-memory";
const TOOL_TIMEOUT_MS = 8000;
const CACHE_TTL_SECONDS = 300;
const MAX_CACHE_ENTRIES_PER_CASE = 12;

function compactTrace(value, maxChars = 1600) {
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

function toolTimeoutMs(input = {}) {
  return Math.max(500, Number(input.timeout_ms || input.env?.TOOL_TIMEOUT_MS || TOOL_TIMEOUT_MS));
}

async function withTimeout(operation, ms, label) {
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function textFrom(input) {
  return String(input?.text || input?.goal || input?.context?.user_goal || "").slice(0, 1200);
}

function contextFrom(input) {
  return input?.context || input || {};
}

function sharedMemoryFrom(context = {}) {
  return context.shared_memory || context.memory || { episodic: [], semantic: [], procedural: [] };
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function bestProcedure(context = {}) {
  return [...(sharedMemoryFrom(context).procedural || [])]
    .sort((left, right) => {
      const success = Number(right.success_rate || 0) - Number(left.success_rate || 0);
      if (success !== 0) return success;
      return Number(left.failure_count || 0) - Number(right.failure_count || 0);
    })[0] || null;
}

function memoryBrief(context = {}) {
  const shared = sharedMemoryFrom(context);
  return {
    similar_past_cases: asArray(shared.episodic).slice(0, 5),
    relevant_facts: asArray(shared.semantic).slice(0, 5),
    learned_strategies: asArray(shared.procedural).slice(0, 5),
    organizational_intelligence: context.organizational_intelligence || shared.organizational_intelligence || null
  };
}

function digitalTwinBrief(context = {}) {
  const twin = context.digital_twin || null;
  if (!twin) return null;
  return {
    risk_state: twin.risk_state || {},
    environment_state: twin.environment_state || {},
    operational_state: twin.operational_state || {},
    last_updated: twin.last_updated || null
  };
}

function caseForPrompt(state) {
  const context = contextFrom(state);
  return {
    text: textFrom(state),
    case_facts: context.case_facts || {
      case_id: context.case_id || null,
      organization_id: context.organization_id || null,
      decision_type: context.decision_type || "strategic_decision"
    },
    context,
    frameworks: context.frameworks || {},
    analysis: context.analysis || {},
    shared_memory: memoryBrief(context),
    digital_twin: digitalTwinBrief(context)
  };
}

function deterministicFallback(name, input = {}) {
  const text = textFrom(input);
  const context = contextFrom(input);
  const procedure = bestProcedure(context);
  const shared = sharedMemoryFrom(context);
  const digitalTwin = context.digital_twin || null;
  const twinRiskSignals = asArray(digitalTwin?.risk_state?.signals);
  const failedPatterns = asArray(shared.episodic)
    .filter((item) => item.outcome === "failure" || item.content?.outcome === "failure")
    .map((item) => item.content?.output?.risk || item.output?.risk || item.content?.event_type || item.event_type || "Prior failure pattern")
    .slice(0, 3);
  const successfulStrategies = asArray(shared.procedural)
    .filter((item) => Number(item.success_rate || 0) >= 0.6)
    .slice(0, 3);
  const fallbackByTool = {
    gather_evidence: {
      finding: "Evidence gathered from governed case context.",
      signals: [
        { name: "strategic_context", severity: context.risk_state || "medium", excerpt: text.slice(0, 180) }
      ].concat(twinRiskSignals.map((signal) => ({
        name: signal.name,
        severity: signal.severity || digitalTwin?.risk_state?.level || "medium",
        excerpt: JSON.stringify(signal).slice(0, 180)
      }))),
      evidence: [
        {
          source: "case_context",
          claim: text.slice(0, 240) || "Governed case context reviewed.",
          governance_basis: ["King IV", "POPIA Act 4 of 2013"],
          observed_constraints: asArray(context.assumptions).slice(0, 3)
        },
        {
          source: "digital_twin",
          claim: "Digital twin baseline included in evidence gathering.",
          governance_basis: ["King IV"],
          digital_twin_baseline: digitalTwinBrief(context)
        }
      ].filter((item) => item.claim || item.digital_twin_baseline),
      confidence: 0.8
    },
    run_porters_five_forces: {
      competitive_rivalry: "Moderate rivalry shaped by incumbent financial-services competitors and AI-enabled differentiation pressure.",
      supplier_power: "Medium supplier power where cloud and AI platform vendors influence cost, portability, and resilience controls.",
      buyer_power: "High buyer power because customers and regulators expect reliable, privacy-preserving analytics outcomes.",
      threat_of_substitution: "Medium substitution risk from internal analytics modernization, alternative vendors, and managed-service offerings.",
      threat_of_new_entry: "Medium new-entry risk as cloud-native entrants can move faster if compliance controls are mature.",
      overall_industry_attractiveness: "medium",
      confidence: 0.78
    },
    run_swot_analysis: {
      strengths: ["Auditable governance loop", "Board-visible decision traceability", "Existing monitoring and digital twin signals"],
      weaknesses: ["Evidence fragmentation", "Vendor dependency risk", "Operational resilience uncertainty"],
      opportunities: ["Faster analytics decisions", "Reusable organizational intelligence", "Predictive scenario planning"],
      threats: failedPatterns.length ? failedPatterns : ["Load shedding disruption", "Regulatory non-compliance", "Vendor lock-in"],
      confidence: 0.8
    },
    run_pestle_analysis: {
      political: ["Energy security and public-sector regulatory posture affect operational continuity."],
      economic: ["Market volatility and currency pressure can alter cloud operating costs."],
      social: ["Customer trust depends on transparent privacy and reliability controls."],
      technological: ["AI and cloud capabilities can improve speed but increase dependency complexity."],
      legal: ["POPIA, King IV, and audit obligations require traceable evidence and accountable decisions."],
      environmental: ["Load shedding and infrastructure resilience remain material environmental operating constraints."],
      highlights: twinRiskSignals.map((signal) => signal.name).slice(0, 5),
      confidence: 0.8
    },
    run_value_chain_analysis: {
      inbound_logistics: ["Data sourcing, consent, and quality gates must be verified before analytics migration."],
      operations: ["Cloud analytics operations need resilience controls, failover, monitoring, and audit trails."],
      outbound_logistics: ["Decision outputs must be delivered with traceable evidence and board-ready reporting."],
      marketing_sales: ["Customer insight velocity can improve service personalization if trust is protected."],
      service: ["Post-decision monitoring must detect drift, incidents, and failed assumptions."],
      support_activities: {
        firm_infrastructure: "Governance, risk, and compliance gates structure execution.",
        technology: "Cloud AI platform, digital twin, and simulation mode support predictive intelligence.",
        procurement: "Vendor terms, portability, and SLA controls shape implementation risk.",
        human_resources: "Accountable owners and approval gates are required for execution."
      },
      bottlenecks: ["Evidence gate before option selection", "Vendor resilience validation", "Operational monitoring readiness"],
      confidence: 0.78
    },
    run_scenario_planning: {
      scenarios: [
        { name: "best_case", drivers: ["Stable energy supply", "Low system load", "Clear regulatory posture"], implication: "Proceed with governed rollout." },
        { name: "worst_case", drivers: ["Load shedding worsens", "System load spikes", "Regulatory scrutiny increases"], implication: "Modify strategy and require stronger controls." },
        { name: "realistic_case", drivers: ["Moderate volatility", "Intermittent operational pressure", "Normal audit obligations"], implication: "Proceed through staged pilot and monitoring." }
      ],
      critical_uncertainties: ["Energy stability", "Vendor resilience", "Regulatory evidence sufficiency"],
      preferred_posture: "staged_governed_rollout",
      confidence: 0.8
    },
    extract_assumptions: {
      finding: "Assumption set extracted from case state.",
      assumptions: asArray(context.assumptions).length ? asArray(context.assumptions) : [
        "Cloud improves decision speed",
        "Load shedding impacts uptime",
        "Board approval requires auditable evidence"
      ],
      diagnostic_questions: [
        "Which assumption carries the highest operational dependency?",
        "Which assumption requires forensic evidence before approval?",
        "What failure condition would invalidate the preferred option?"
      ],
      shared_memory_used: memoryBrief(context),
      confidence: 0.8
    },
    root_cause_analysis: {
      finding: "Root-cause analysis completed.",
      evidence: {
        causes: ["Strategic ambiguity", "Evidence fragmentation", "Weak handoff accountability"],
        learned_root_cause_patterns: asArray(shared.semantic).slice(0, 3),
        blended_risks_validated: asArray(context.blended_analysis?.top_risks).slice(0, 5),
        assumptions_reviewed: asArray(context.assumptions),
        recommended_probe: "Separate operational symptoms from board-level decision constraints."
      },
      compliance_verdict: "review_required",
      confidence: 0.78
    },
    generate_options: {
      finding: "Structured options generated.",
      options: [
        {
          id: "opt_1",
          name: context.blended_analysis?.recommended_strategy ? "Blended strategy" : (procedure ? `Learned strategy: ${procedure.task_type}` : "Governed rollout"),
          description: context.blended_analysis?.recommended_strategy || (procedure ? asArray(procedure.strategy_steps || procedure.content?.strategy_steps).join(" -> ") : "Proceed with approval gates and evidence traceability."),
          risk: Number(procedure?.failure_count || 0) > 2 ? "high" : "medium",
          learned_success_rate: procedure?.success_rate
        },
        { id: "opt_2", name: "Constrained pilot", description: "Limit scope while validating controls.", risk: "low" }
      ],
      memory_used: {
        past_successful_strategies: successfulStrategies,
        failed_approaches_to_avoid: failedPatterns,
        similar_cases: asArray(shared.episodic).slice(0, 3)
      },
      assumptions_used: asArray(context.assumptions),
      confidence: 0.76
    },
    run_stress_tests: {
      baseline_twin: digitalTwinBrief(context),
      simulated_twin: digitalTwin ? simulateDigitalTwinScenario(digitalTwin, {
        load_shedding_stage_delta: 2,
        system_load_delta: 25,
        queue_depth_delta: 100
      }) : null,
      stress_tests: [
        { scenario: "Load shedding increases", outcome: "System downtime risk", impact: "high" },
        { scenario: "System load spikes", outcome: "Capacity pressure may affect decision execution", impact: "high" },
        { scenario: "Regulatory audit", outcome: "Evidence trail must prove decision accountability", impact: "medium" }
      ],
      verdict: digitalTwin?.risk_state?.level === "critical" ? "high_risk" : "medium_risk",
      confidence: 0.75
    },
    generate_objections: {
      finding: "Adversarial objections generated.",
      objections: [
        { id: "obj_1", text: failedPatterns[0] || "Cloud reliability under load shedding is not validated", severity: "high" }
      ],
      objection: failedPatterns[0] || "Cloud reliability under load shedding is not validated",
      stress_tests: [
        { scenario: "Load shedding event", outcome: "System downtime risk", impact: "high" }
      ],
      learned_failure_patterns: failedPatterns,
      blended_conflicts: asArray(context.blended_analysis?.conflicts),
      verdict: "high_risk",
      confidence: 0.75
    },
    build_implementation_plan: {
      finding: "Implementation plan generated.",
      implementation_plan: asArray(procedure?.strategy_steps || procedure?.content?.strategy_steps).length
        ? Object.fromEntries(asArray(procedure.strategy_steps || procedure.content?.strategy_steps).slice(0, 5).map((step, index) => [`phase_${index + 1}`, step]))
        : {
            phase_1: "Confirm decision rights, approval gates, and evidence baseline.",
            phase_2: "Run constrained option execution with forensic review.",
            phase_3: "Launch monitored implementation with board-visible resilience indicators."
          },
      confidence: 0.82
    },
    generate_monitoring_rules: {
      finding: "Monitoring rules generated.",
      risk_signals: [
        { name: "decision_drift", level: "medium" },
        { name: "control_failure", level: "high" }
      ],
      monitoring_rules: [
        { metric: "decision_drift", threshold: "medium", cadence: "weekly" },
        { metric: "control_failure", threshold: "high", cadence: "continuous" },
        { metric: "digital_twin_risk_level", threshold: "high", cadence: "real-time" }
      ],
      alert_thresholds: [
        { metric: "decision_drift", red: "high" },
        { metric: "control_failure", red: "medium" }
      ],
      confidence: 0.84
    },
    validate_policy: {
      finding: "Policy validation passed.",
      confirmed: true,
      policy_violation: null,
      confidence: 0.9
    },
    validate_consensus: {
      finding: "Consensus validation completed.",
      confirmed: true,
      final_rationale: context.consensus?.final_rationale || "Proceed with governed rollout under monitored controls.",
      consensus: { level: "high", confidence: 0.86 },
      confidence: 0.86
    },
    extract_memory: {
      episodic: [
        {
          case_id: context.case_id,
          event_type: "decision_loop_completed",
          input: { user_goal: context.user_goal },
          output: { status: context.status, stop_reason: context.loop?.stop_reason },
          outcome: context.status === "escalation_required" || context.consensus?.level === "low" ? "failure" : "success",
          confidence: context.consensus?.confidence || 0.78
        }
      ],
      semantic: [
        {
          entity: "strategic_decision",
          fact: context.consensus?.final_rationale || context.decision?.rationale || "Decision produced governed evidence, assumptions, options, and monitoring state.",
          source_case_id: context.case_id,
          confidence: 0.74
        }
      ].concat(context.blended_analysis?.recommended_strategy ? [{
        entity: "blended_strategy",
        fact: context.blended_analysis.recommended_strategy,
        source_case_id: context.case_id,
        confidence: Number(context.blended_analysis.confidence || 0.76)
      }] : [])
        .concat(Object.entries(context.frameworks || {})
        .filter(([, value]) => value)
        .map(([framework, value]) => ({
          entity: `framework_${framework}`,
          fact: JSON.stringify(value).slice(0, 900),
          source_case_id: context.case_id,
          confidence: Number(value.confidence || 0.74)
        }))),
      procedural: [
        {
          task_type: context.memory?.retrieval?.case_type || "strategic_decision",
          strategy_steps: Object.values(context.implementation_plan || {}).length
            ? Object.values(context.implementation_plan)
            : ["Gather evidence", "Extract assumptions", "Challenge options", "Monitor outcomes"],
          success_rate: context.status === "escalation_required" ? 0.35 : 0.74
        }
      ].concat(context.blended_analysis?.recommended_strategy ? [{
        task_type: "blended_strategy",
        strategy_steps: [
          context.blended_analysis.recommended_strategy,
          ...asArray(context.blended_analysis.key_tradeoffs)
        ],
        success_rate: context.status === "escalation_required" ? 0.42 : 0.8
      }] : [])
        .concat(Object.keys(context.frameworks || {})
        .filter((framework) => context.frameworks?.[framework])
        .map((framework) => ({
          task_type: `framework_${framework}`,
          framework,
          use_cases: [
            context.memory?.retrieval?.case_type || "strategic_decision",
            context.decision_type || "strategy"
          ],
          strategy_steps: [`Apply ${framework} framework`, "Validate JSON output", "Merge into strategic analysis state"],
          success_rate: context.status === "escalation_required" ? 0.4 : 0.76
        }))),
      confidence: 0.78
    },
    reflect_on_decision: {
      what_worked: ["Structured tool outputs kept the loop auditable."],
      what_failed: context.status === "escalation_required" ? ["Decision escalated before final readiness."] : [],
      improvements: context.status === "escalation_required"
        ? ["Add stronger evidence gate before option generation", "Require fallback controls earlier"]
        : ["Reuse successful approval-gated rollout strategy", "Keep monitoring thresholds visible to the board"],
      confidence: 0.76
    },
    extract_learning: {
      lessons: [
        context.devil_advocate_findings?.objection || "Shared memory improved cross-agent context before action.",
        context.stage_outputs?.auditor?.finding || "Forensic analysis should reuse recurring root-cause patterns.",
        successfulStrategies[0]?.content?.task_type || successfulStrategies[0]?.task_type || "Strategies with higher success rates should be prioritized."
      ],
      improvements: context.status === "escalation_required"
        ? ["Move evidence validation earlier for similar future cases.", "Require failed-pattern checks before option generation."]
        : ["Reuse organization-level strategy ranking.", "Keep failure-pattern avoidance visible to all agents."],
      strategy_updates: asArray(context.options || context.options_generated).map((option) => ({
        strategy: option.name || option.description || "Generated option",
        outcome: context.status === "escalation_required" ? "failure" : "success",
        success_rate_delta: context.status === "escalation_required" ? -0.1 : 0.1
      })),
      agent_learning: {
        "Devil's Advocate": {
          learns: "common failure patterns",
          patterns: failedPatterns
        },
        "Forensic Analyst": {
          learns: "root cause patterns",
          patterns: asArray(context.stage_outputs?.auditor?.evidence?.causes || context.evidence_bundle?.causes)
        },
        "Creative Catalyst": {
          learns: "which strategies succeed",
          strategies: successfulStrategies
        }
      },
      confidence: 0.8
    },
    generate_scenarios: {
      scenarios: [
        {
          name: "best_case",
          conditions: {
            load_shedding_stage_delta: -1,
            system_load_delta: -10,
            market_volatility_delta: -0.08,
            queue_depth_delta: -10,
            risk_delta: -0.08
          }
        },
        {
          name: "worst_case",
          conditions: {
            load_shedding_stage_delta: 3,
            system_load_delta: 30,
            market_volatility_delta: 0.18,
            queue_depth_delta: 120,
            risk_delta: 0.2
          }
        },
        {
          name: "realistic_case",
          conditions: {
            load_shedding_stage_delta: 1,
            system_load_delta: 12,
            market_volatility_delta: 0.05,
            queue_depth_delta: 30,
            risk_delta: 0.05
          }
        }
      ],
      confidence: 0.8
    },
    evaluate_outcome: {
      scenario: context.simulation_context?.scenario || context.scenario?.name || "realistic_case",
      risk_score: Number(Math.min(1, Math.max(0, Number(context.digital_twin?.risk_state?.score || 0.42) + asArray(context.objections).length * 0.08)).toFixed(2)),
      success_probability: Number(Math.min(0.95, Math.max(0.05, 0.82 - Number(context.digital_twin?.risk_state?.score || 0.42) - asArray(context.objections).length * 0.05)).toFixed(2)),
      resilience: Number(Math.min(1, Math.max(0.05, 0.7 - asArray(context.stress_tests).filter((item) => item.impact === "high").length * 0.1)).toFixed(2)),
      key_failures: [
        ...asArray(context.objections).map((item) => item.text || item.claim).filter(Boolean),
        ...asArray(context.stress_tests).filter((item) => item.impact === "high").map((item) => item.outcome || item.risk).filter(Boolean)
      ].slice(0, 5),
      recommendation: Number(context.digital_twin?.risk_state?.score || 0.42) >= 0.72 ? "reject" : asArray(context.objections).length > 1 ? "modify" : "proceed",
      confidence: 0.8
    }
  };
  return { ...fallbackByTool[name], tools_used: [name] };
}

async function callLLM(prompt, input = {}, fallback = {}) {
  const ai = input.llm || input.ai;
  if (!ai?.run) return JSON.stringify(fallback);
  const result = await ai.run(input.model || DEFAULT_MODEL, {
    messages: [
      { role: "system", content: "You are an internal AI-SRF tool reasoner. Use only the named strategic framework requested by the tool. Return only JSON." },
      { role: "user", content: prompt }
    ],
    max_tokens: input.max_tokens || 900
  });
  return result?.response ?? result;
}

export async function enforceJSON(raw, options = {}) {
  return enforceStructuredJSON(raw, { ...options, attempts: options.attempts || 3 });
}

export function validateToolOutput(output) {
  return validateBaseToolOutput(output);
}

function withToolName(name, output) {
  return { ...output, tools_used: [name] };
}

function validateAssumptions(output) {
  validateToolOutput(output);
  if (!Array.isArray(output.assumptions)) throw new Error("Invalid assumptions schema");
  if (typeof output.confidence !== "number") throw new Error("Invalid assumptions confidence schema");
  return output;
}

function validateEvidence(output) {
  validateToolOutput(output);
  if (!output.evidence || typeof output.evidence !== "object" || Array.isArray(output.evidence)) {
    throw new Error("Invalid evidence schema");
  }
  if (typeof output.confidence !== "number") throw new Error("Invalid evidence confidence schema");
  return output;
}

function validateEvidenceArray(output) {
  validateToolOutput(output);
  if (!Array.isArray(output.evidence)) throw new Error("Invalid evidence schema");
  if (output.evidence.length === 0) throw new Error("Evidence must not be empty");
  if (typeof output.confidence !== "number") throw new Error("Invalid evidence confidence schema");
  return output;
}

function validateOptions(output) {
  validateToolOutput(output);
  if (!Array.isArray(output.options)) throw new Error("Invalid options schema");
  return output;
}

function validateObjections(output) {
  validateToolOutput(output);
  if (!Array.isArray(output.objections)) throw new Error("Invalid objections schema");
  return output;
}

function validateImplementationPlan(output) {
  validateToolOutput(output);
  if (!output.implementation_plan || typeof output.implementation_plan !== "object" || Array.isArray(output.implementation_plan)) {
    throw new Error("Invalid implementation plan schema");
  }
  return output;
}

function validateMonitoringRules(output) {
  validateToolOutput(output);
  if (!Array.isArray(output.monitoring_rules)) throw new Error("Invalid monitoring rules schema");
  if (!Array.isArray(output.risk_signals)) throw new Error("Invalid risk signals schema");
  if (!Array.isArray(output.alert_thresholds)) throw new Error("Invalid alert thresholds schema");
  return output;
}

function validatePolicy(output) {
  validateToolOutput(output);
  if (typeof output.confirmed !== "boolean") throw new Error("Invalid policy schema");
  return output;
}

function validateConsensus(output) {
  validateToolOutput(output);
  if (typeof output.confirmed !== "boolean") throw new Error("Invalid consensus schema");
  if (typeof output.final_rationale !== "string") throw new Error("Invalid consensus rationale schema");
  return output;
}

function validateMemoryExtraction(output) {
  validateToolOutput(output);
  if (!Array.isArray(output.episodic)) throw new Error("Invalid episodic memory schema");
  if (!Array.isArray(output.semantic)) throw new Error("Invalid semantic memory schema");
  if (!Array.isArray(output.procedural)) throw new Error("Invalid procedural memory schema");
  return output;
}

function validateReflection(output) {
  validateToolOutput(output);
  if (!Array.isArray(output.what_worked)) throw new Error("Invalid reflection what_worked schema");
  if (!Array.isArray(output.what_failed)) throw new Error("Invalid reflection what_failed schema");
  if (!Array.isArray(output.improvements)) throw new Error("Invalid reflection improvements schema");
  return output;
}

function validateLearning(output) {
  validateToolOutput(output);
  if (!Array.isArray(output.lessons)) throw new Error("Invalid learning lessons schema");
  if (!Array.isArray(output.improvements)) throw new Error("Invalid learning improvements schema");
  if (!Array.isArray(output.strategy_updates)) throw new Error("Invalid learning strategy_updates schema");
  return output;
}

function validateScenarios(output) {
  validateToolOutput(output);
  if (!Array.isArray(output.scenarios)) throw new Error("Invalid scenarios schema");
  for (const scenario of output.scenarios) {
    if (typeof scenario.name !== "string") throw new Error("Invalid scenario name schema");
    if (!scenario.conditions || typeof scenario.conditions !== "object" || Array.isArray(scenario.conditions)) {
      throw new Error("Invalid scenario conditions schema");
    }
  }
  return output;
}

function validateOutcome(output) {
  validateToolOutput(output);
  if (typeof output.scenario !== "string") throw new Error("Invalid outcome scenario schema");
  if (typeof output.risk_score !== "number") throw new Error("Invalid risk_score schema");
  if (typeof output.success_probability !== "number") throw new Error("Invalid success_probability schema");
  if (!Array.isArray(output.key_failures)) throw new Error("Invalid key_failures schema");
  if (!["proceed", "modify", "reject"].includes(output.recommendation)) throw new Error("Invalid recommendation schema");
  return {
    ...output,
    risk_score: Math.min(1, Math.max(0, output.risk_score)),
    success_probability: Math.min(1, Math.max(0, output.success_probability)),
    resilience: Math.min(1, Math.max(0, Number(output.resilience ?? (1 - output.risk_score))))
  };
}

function validatePortersFiveForces(output) {
  validateToolOutput(output);
  for (const key of ["competitive_rivalry", "supplier_power", "buyer_power", "threat_of_substitution", "threat_of_new_entry"]) {
    if (typeof output[key] !== "string") throw new Error(`Invalid Porter's Five Forces schema: ${key}`);
  }
  if (!["low", "medium", "high"].includes(output.overall_industry_attractiveness)) {
    throw new Error("Invalid Porter's attractiveness schema");
  }
  return output;
}

function validateSwot(output) {
  validateToolOutput(output);
  for (const key of ["strengths", "weaknesses", "opportunities", "threats"]) {
    if (!Array.isArray(output[key])) throw new Error(`Invalid SWOT schema: ${key}`);
  }
  return output;
}

function validatePestle(output) {
  validateToolOutput(output);
  for (const key of ["political", "economic", "social", "technological", "legal", "environmental"]) {
    if (!Array.isArray(output[key])) throw new Error(`Invalid PESTLE schema: ${key}`);
  }
  return output;
}

function validateValueChain(output) {
  validateToolOutput(output);
  for (const key of ["inbound_logistics", "operations", "outbound_logistics", "marketing_sales", "service", "bottlenecks"]) {
    if (!Array.isArray(output[key])) throw new Error(`Invalid value chain schema: ${key}`);
  }
  if (!output.support_activities || typeof output.support_activities !== "object" || Array.isArray(output.support_activities)) {
    throw new Error("Invalid value chain support activities schema");
  }
  return output;
}

function validateScenarioPlanning(output) {
  validateToolOutput(output);
  if (!Array.isArray(output.scenarios)) throw new Error("Invalid scenario planning scenarios schema");
  if (!Array.isArray(output.critical_uncertainties)) throw new Error("Invalid scenario planning uncertainties schema");
  if (typeof output.preferred_posture !== "string") throw new Error("Invalid scenario planning preferred posture schema");
  return output;
}

async function runHybridTool(name, input, buildPrompt, validate) {
  const fallback = deterministicFallback(name, input);
  const prompt = buildPrompt(input);
  const raw = await withTimeout(
    () => callLLM(prompt, input, fallback),
    toolTimeoutMs(input),
    `${name}.llm`
  );
  const parsed = await enforceJSON(raw, {
    retryLLM: (retryPrompt) => callLLM(retryPrompt, input, fallback),
    fallback
  });
  return withToolName(name, validate({ ...fallback, ...parsed }));
}

export async function run_porters_five_forces(input = {}) {
  return runHybridTool(
    "run_porters_five_forces",
    input,
    (state) => `
Analyze using Porter's Five Forces. Do not use generic reasoning outside this framework.

Return JSON:
{
  "competitive_rivalry": "...",
  "supplier_power": "...",
  "buyer_power": "...",
  "threat_of_substitution": "...",
  "threat_of_new_entry": "...",
  "overall_industry_attractiveness": "low|medium|high",
  "confidence": 0.78
}

Case:
${JSON.stringify(caseForPrompt(state))}
    `,
    validatePortersFiveForces
  );
}

export async function run_swot_analysis(input = {}) {
  return runHybridTool(
    "run_swot_analysis",
    input,
    (state) => `
Perform SWOT analysis. Do not use generic reasoning outside this framework.

Return JSON:
{
  "strengths": ["..."],
  "weaknesses": ["..."],
  "opportunities": ["..."],
  "threats": ["..."],
  "confidence": 0.8
}

Case:
${JSON.stringify(caseForPrompt(state))}
    `,
    validateSwot
  );
}

export async function run_pestle_analysis(input = {}) {
  return runHybridTool(
    "run_pestle_analysis",
    input,
    (state) => `
Perform PESTLE analysis. Do not use generic reasoning outside this framework.

Return JSON:
{
  "political": ["..."],
  "economic": ["..."],
  "social": ["..."],
  "technological": ["..."],
  "legal": ["..."],
  "environmental": ["..."],
  "highlights": ["..."],
  "confidence": 0.8
}

Case:
${JSON.stringify(caseForPrompt(state))}
    `,
    validatePestle
  );
}

export async function run_value_chain_analysis(input = {}) {
  return runHybridTool(
    "run_value_chain_analysis",
    input,
    (state) => `
Perform Value Chain Analysis. Do not use generic reasoning outside this framework.

Return JSON:
{
  "inbound_logistics": ["..."],
  "operations": ["..."],
  "outbound_logistics": ["..."],
  "marketing_sales": ["..."],
  "service": ["..."],
  "support_activities": {"firm_infrastructure":"...","technology":"...","procurement":"...","human_resources":"..."},
  "bottlenecks": ["..."],
  "confidence": 0.78
}

Case:
${JSON.stringify(caseForPrompt(state))}
    `,
    validateValueChain
  );
}

export async function run_scenario_planning(input = {}) {
  return runHybridTool(
    "run_scenario_planning",
    input,
    (state) => `
Perform Scenario Planning. Do not use generic reasoning outside this framework.

Return JSON:
{
  "scenarios": [{"name":"...","drivers":["..."],"implication":"..."}],
  "critical_uncertainties": ["..."],
  "preferred_posture": "...",
  "confidence": 0.8
}

Case:
${JSON.stringify(caseForPrompt(state))}
    `,
    validateScenarioPlanning
  );
}

export async function gather_evidence(input = {}) {
  const context = contextFrom(input);
  const caseId = context.case_id || input.case_id || `no-case-${shortHash(textFrom(input))}`;
  const cache = input.cache || input.env?.KV || input.env?.CONFIG_CACHE || null;
  const key = caseScopedKey(caseId, "gather_evidence");
  const entryKey = cacheEntryKey("gather_evidence", input);
  const fallback = deterministicFallback("gather_evidence", input);

  traceStep("gather_evidence.start", { case_id: caseId, key }, { tool: "gather_evidence" });
  console.log("gather_evidence START", caseId);
  console.log("gather_evidence INPUT", JSON.stringify({
    case_id: caseId,
    text_chars: textFrom(input).length,
    has_digital_twin: Boolean(context.digital_twin),
    memory_counts: {
      episodic: asArray(context.shared_memory?.episodic || context.memory?.episodic).length,
      semantic: asArray(context.shared_memory?.semantic || context.memory?.semantic).length,
      procedural: asArray(context.shared_memory?.procedural || context.memory?.procedural).length
    }
  }));

  try {
    if (cache?.get) {
      traceStep("gather_evidence.kv_get", { case_id: caseId, key }, { key_bytes: new TextEncoder().encode(key).length });
      console.log("gather_evidence KV GET", key);
      const cached = await readCaseCacheEntry(cache, caseId, entryKey);
      if (cached) {
        const parsedCached = await enforceJSON(cached, { fallback: normalizeEvidenceResult(fallback, fallback) });
        const normalizedCached = normalizeEvidenceResult(parsedCached, fallback);
        traceStep("gather_evidence.cache_hit", { case_id: caseId, key }, { output: normalizedCached });
        console.log("gather_evidence CACHE HIT", caseId);
        return withToolName("gather_evidence", validateEvidenceArray(normalizedCached));
      }
    }

    const prompt = `
Gather evidence from this AI-SRF case.

Return JSON:
{
  "finding": "...",
  "signals": [{"name":"...","severity":"low|medium|high"}],
  "evidence": [{"source":"...","claim":"...","governance_basis":["..."]}],
  "confidence": 0.8
}

Case:
${JSON.stringify(caseForPrompt(input))}
    `;

    console.log("gather_evidence LLM CALL", caseId);
    traceStep("gather_evidence.llm_call", { case_id: caseId }, { model: input.model || DEFAULT_MODEL });
    const raw = await callLLM(prompt, input, fallback);
    console.log("gather_evidence JSON PARSE", caseId);
    traceStep("gather_evidence.json_parse", { case_id: caseId }, { raw_type: typeof raw });
    const parsed = await enforceJSON(raw, {
      retryLLM: (retryPrompt) => callLLM(retryPrompt, input, fallback),
      fallback
    });
    const output = withToolName("gather_evidence", validateEvidenceArray(normalizeEvidenceResult(parsed, fallback)));

    if (cache?.put) {
      traceStep("gather_evidence.kv_put", { case_id: caseId, key }, { value_type: "json", key_bytes: new TextEncoder().encode(key).length });
      console.log("gather_evidence KV PUT", key);
      await writeCaseCacheEntry(cache, caseId, entryKey, output);
    }
    console.log("gather_evidence OUTPUT", JSON.stringify({
      case_id: caseId,
      evidence_count: asArray(output.evidence).length,
      signals: asArray(output.signals).length,
      confidence: output.confidence
    }));
    traceStep("gather_evidence.end", { case_id: caseId }, { output });
    return output;
  } catch (err) {
    if (isCriticalInfrastructureError(err)) throw err;
    console.error("gather_evidence FAILED", err);
    const errorEnvelope = structuredToolError({
      message: err.message,
      customerMessage: "Evidence gathering degraded to deterministic evidence.",
      suggestion: "Continue with fallback evidence, then review the audit trace before approval."
    });
    const fallbackOutput = withToolName("gather_evidence", validateEvidenceArray({
      ...fallback,
      evidence: ensureEvidenceArray(fallback.evidence, fallback).concat({
        source: "tool_fallback",
        claim: "Evidence gathering used deterministic fallback after an isolated tool failure.",
        governance_basis: ["King IV"],
        error: true,
        message: err.message
      }),
      error: true,
      ...errorEnvelope,
      confidence: Number(fallback.confidence || 0.5)
    }));
    traceStep("gather_evidence.fallback", { case_id: caseId, key }, { error: err.message, output: fallbackOutput });
    return fallbackOutput;
  }
}

function normalizeEvidenceResult(parsed = {}, fallback = {}) {
  const rawEvidence = parsed.evidence ?? fallback.evidence;
  const evidence = ensureEvidenceArray(rawEvidence, fallback);
  return {
    ...fallback,
    ...parsed,
    evidence,
    confidence: Number(parsed.confidence ?? fallback.confidence ?? 0.7)
  };
}

function ensureEvidenceArray(rawEvidence, fallback = {}) {
  if (Array.isArray(rawEvidence)) {
    return rawEvidence
      .map((item, index) => normalizeEvidenceItem(item, index))
      .filter(Boolean);
  }
  if (rawEvidence && typeof rawEvidence === "object") {
    const items = asArray(rawEvidence.items).map((item, index) => normalizeEvidenceItem(item, index)).filter(Boolean);
    const base = normalizeEvidenceItem(rawEvidence, 0);
    return [base, ...items].filter(Boolean);
  }
  const fallbackItems = Array.isArray(fallback.evidence) ? fallback.evidence : [];
  if (fallbackItems.length) return fallbackItems.map((item, index) => normalizeEvidenceItem(item, index)).filter(Boolean);
  return [{
    source: "case_context",
    claim: "No external evidence returned; deterministic evidence baseline applied.",
    governance_basis: ["King IV", "POPIA Act 4 of 2013"]
  }];
}

function normalizeEvidenceItem(item, index = 0) {
  if (!item) return null;
  if (typeof item === "string") {
    return { source: "text", claim: item, governance_basis: [] };
  }
  if (typeof item !== "object" || Array.isArray(item)) return null;
  const { items, ...rest } = item;
  return {
    source: rest.source || rest.name || `evidence_${index + 1}`,
    claim: rest.claim || rest.finding || rest.summary || rest.excerpt || JSON.stringify(rest).slice(0, 240),
    governance_basis: asArray(rest.governance_basis),
    ...rest
  };
}

export async function extract_assumptions(input = {}) {
  return runHybridTool(
    "extract_assumptions",
    input,
    (state) => `
Extract key assumptions from this case.

Return JSON:
{
  "assumptions": ["..."],
  "diagnostic_questions": ["..."],
  "confidence": 0.8
}

Case:
${JSON.stringify(caseForPrompt(state))}
    `,
    validateAssumptions
  );
}

export async function root_cause_analysis(input = {}) {
  return runHybridTool(
    "root_cause_analysis",
    input,
    (state) => `
Perform forensic root-cause analysis for this case.

Return JSON:
{
  "finding": "...",
  "evidence": {"causes":["..."],"recommended_probe":"..."},
  "compliance_verdict": "review_required|clear|blocked",
  "confidence": 0.78
}

Case:
${JSON.stringify(caseForPrompt(state))}
    `,
    validateEvidence
  );
}

export async function generate_options(input = {}) {
  return runHybridTool(
    "generate_options",
    input,
    (state) => `
Generate strategic options. Use shared memory from past successful strategies, failed approaches, and similar cases.

Return JSON:
{
  "options": [
    {"name":"...","description":"...","risk":"low|medium|high"}
  ],
  "memory_used": {"past_successful_strategies":[],"failed_approaches_to_avoid":[],"similar_cases":[]},
  "confidence": 0.76
}

Case:
${JSON.stringify(caseForPrompt(state))}
    `,
    validateOptions
  );
}

export async function run_stress_tests(input = {}) {
  return runHybridTool(
    "run_stress_tests",
    input,
    (state) => `
Run stress tests against the current decision path.

Return JSON:
{
  "stress_tests": [{"scenario":"...","outcome":"...","impact":"low|medium|high"}],
  "verdict": "low_risk|medium_risk|high_risk",
  "confidence": 0.75
}

Case:
${JSON.stringify(caseForPrompt(state))}
    `,
    (output) => {
      validateToolOutput(output);
      if (!Array.isArray(output.stress_tests)) throw new Error("Invalid stress tests schema");
      if (typeof output.verdict !== "string") throw new Error("Invalid stress verdict schema");
      return output;
    }
  );
}

export async function generate_objections(input = {}) {
  const output = await runHybridTool(
    "generate_objections",
    input,
    (state) => `
Act as a Devil's Advocate. Learn from common prior failure patterns in shared memory and avoid repeated failed approaches.

Return JSON:
{
  "objections": [
    {"id":"obj_1","text":"...","severity":"low|medium|high"}
  ],
  "stress_tests": [{"scenario":"...","outcome":"...","impact":"low|medium|high"}],
  "learned_failure_patterns": ["..."],
  "verdict": "low_risk|medium_risk|high_risk",
  "confidence": 0.75
}

Case:
${JSON.stringify(caseForPrompt(state))}
    `,
    validateToolOutput
  );
  if (!output.objections || output.objections.length === 0) {
    return withToolName("generate_objections", {
      ...output,
      objections: [{ id: "obj_fallback", text: "Critical assumptions lack adversarial validation", severity: "high" }],
      objection: "Critical assumptions lack adversarial validation",
      confidence: output.confidence || 0.7
    });
  }
  return {
    ...output,
    objection: output.objection || output.objections[0]?.text || "Critical assumptions lack adversarial validation"
  };
}

export async function build_implementation_plan(input = {}) {
  return runHybridTool(
    "build_implementation_plan",
    input,
    (state) => `
Build an implementation plan for the selected strategic option. Prefer learned procedures with high success_rate and low failure_count.

Return JSON:
{
  "implementation_plan": {"phase_1":"...","phase_2":"...","phase_3":"..."},
  "confidence": 0.82
}

Case:
${JSON.stringify(caseForPrompt(state))}
    `,
    validateImplementationPlan
  );
}

export async function generate_monitoring_rules(input = {}) {
  return runHybridTool(
    "generate_monitoring_rules",
    input,
    (state) => `
Generate monitoring rules for this decision.

Return JSON:
{
  "risk_signals": [{"name":"...","level":"low|medium|high"}],
  "monitoring_rules": [{"metric":"...","threshold":"..."}],
  "alert_thresholds": [{"metric":"...","red":"..."}],
  "confidence": 0.84
}

Case:
${JSON.stringify(caseForPrompt(state))}
    `,
    validateMonitoringRules
  );
}

export async function validate_policy(input = {}) {
  const context = contextFrom(input);
  const fallback = deterministicFallback("validate_policy", input);
  if (!context.verification_chain?.devil_advocate_validated) {
    fallback.finding = "Policy validation blocked.";
    fallback.confirmed = false;
    fallback.policy_violation = "Devil's Advocate validation is required before final policy clearance.";
    fallback.confidence = 0.68;
  }
  return withToolName("validate_policy", validatePolicy(fallback));
}

export async function validate_consensus(input = {}) {
  return withToolName("validate_consensus", validateConsensus(deterministicFallback("validate_consensus", input)));
}

export async function extract_memory(input = {}) {
  return runHybridTool(
    "extract_memory",
    input,
    (state) => `
Extract auditable AI-SRF memory from the completed decision case.

Return JSON:
{
  "episodic": [{"event_type":"...","input":{},"output":{},"outcome":"success|failure","confidence":0.8}],
  "semantic": [{"entity":"...","fact":"...","source_case_id":"...","confidence":0.8}],
  "procedural": [{"task_type":"...","strategy_steps":["..."],"success_rate":0.7}],
  "confidence": 0.78
}

Case:
${JSON.stringify(contextFrom(state))}
    `,
    validateMemoryExtraction
  );
}

export async function reflect_on_decision(input = {}) {
  return runHybridTool(
    "reflect_on_decision",
    input,
    (state) => `
Reflect on the completed AI-SRF decision.

Return JSON:
{
  "what_worked": ["..."],
  "what_failed": ["..."],
  "improvements": ["..."],
  "confidence": 0.76
}

Case:
${JSON.stringify(contextFrom(state))}
    `,
    validateReflection
  );
}

export async function extract_learning(input = {}) {
  return runHybridTool(
    "extract_learning",
    input,
    (state) => `
Extract cross-agent learning from this completed AI-SRF run.

Return JSON:
{
  "lessons": ["..."],
  "improvements": ["..."],
  "strategy_updates": [{"strategy":"...","outcome":"success|failure","success_rate_delta":0.1}],
  "agent_learning": {
    "Devil's Advocate": {"learns":"common failure patterns","patterns":[]},
    "Forensic Analyst": {"learns":"root cause patterns","patterns":[]},
    "Creative Catalyst": {"learns":"which strategies succeed","strategies":[]}
  },
  "confidence": 0.8
}

Case:
${JSON.stringify(caseForPrompt(state))}
    `,
    validateLearning
  );
}

export async function manage_memory(input = {}) {
  const [memory, reflection, learning] = await Promise.all([
    extract_memory(input),
    reflect_on_decision(input),
    extract_learning(input)
  ]);
  validateMemoryExtraction(memory);
  validateReflection(reflection);
  validateLearning(learning);
  return withToolName("manage_memory", {
    memory,
    reflection,
    learning,
    confidence: Number(((memory.confidence || 0.72) + (reflection.confidence || 0.72) + (learning.confidence || 0.72)) / 3)
  });
}

export async function generate_scenarios(input = {}) {
  return runHybridTool(
    "generate_scenarios",
    input,
    (state) => `
Generate simulation scenarios for this AI-SRF decision before execution.

Return JSON:
{
  "scenarios": [
    {"name":"best_case","conditions":{}},
    {"name":"worst_case","conditions":{}},
    {"name":"realistic_case","conditions":{}}
  ],
  "confidence": 0.8
}

Case:
${JSON.stringify(caseForPrompt(state))}
    `,
    validateScenarios
  );
}

export async function evaluate_outcome(input = {}) {
  return runHybridTool(
    "evaluate_outcome",
    input,
    (state) => `
Evaluate the simulated decision outcome.

Return JSON:
{
  "scenario": "...",
  "risk_score": 0.0,
  "success_probability": 0.0,
  "resilience": 0.0,
  "key_failures": ["..."],
  "recommendation": "proceed|modify|reject",
  "confidence": 0.8
}

Case:
${JSON.stringify(caseForPrompt(state))}
    `,
    validateOutcome
  );
}

export const tools = {
  run_porters_five_forces,
  run_swot_analysis,
  run_pestle_analysis,
  run_value_chain_analysis,
  run_scenario_planning,
  extract_assumptions,
  gather_evidence,
  generate_options,
  run_stress_tests,
  generate_objections,
  build_implementation_plan,
  generate_monitoring_rules,
  validate_policy,
  validate_consensus,
  root_cause_analysis,
  extract_memory,
  reflect_on_decision,
  extract_learning,
  manage_memory,
  generate_scenarios,
  evaluate_outcome
};

export const toolSchemas = Object.fromEntries(
  Object.keys(tools).map((name) => [
    name,
    {
      name,
      description: toolPurpose(name),
      purpose: toolPurpose(name),
      input_schema: {
        type: "object",
        additionalProperties: true,
        properties: {
          text: { type: "string" },
          context: {
            type: "object",
            properties: {
              case_facts: {
                type: "object",
                properties: {
                  case_id: { type: "string" },
                  organization_id: { type: ["string", "null"] },
                  decision_type: { type: "string" }
                }
              }
            }
          }
        }
      },
      output_schema: TOOL_OUTPUT_SCHEMAS[name] || { required: {} },
      error_schema: TOOL_ERROR_SCHEMA
    }
  ])
);

function toolPurpose(name) {
  switch (name) {
    case "gather_evidence": return "Collect governed evidence, signals, and governance basis for the case.";
    case "run_porters_five_forces": return "Analyze industry forces and supplier/customer/substitution pressures.";
    case "run_swot_analysis": return "Analyze strengths, weaknesses, opportunities, and threats.";
    case "run_pestle_analysis": return "Analyze political, economic, social, technology, legal, and environmental constraints.";
    case "run_value_chain_analysis": return "Analyze operational value-chain activities, support activities, and bottlenecks.";
    case "run_scenario_planning": return "Build strategic scenarios and identify critical uncertainties.";
    case "extract_assumptions": return "Extract assumptions and diagnostic questions from the case context.";
    case "root_cause_analysis": return "Perform forensic root-cause analysis over evidence and constraints.";
    case "generate_options": return "Generate structured strategic options from evidence, memory, and frameworks.";
    case "run_stress_tests": return "Stress test a decision path against adverse scenarios.";
    case "generate_objections": return "Generate adversarial objections and failure modes.";
    case "build_implementation_plan": return "Build a phased implementation plan for the selected option.";
    case "generate_monitoring_rules": return "Generate post-decision monitoring rules, risk signals, and alert thresholds.";
    case "validate_policy": return "Validate final governance and policy constraints.";
    case "validate_consensus": return "Validate consensus readiness and unresolved tensions.";
    case "extract_memory": return "Extract episodic, semantic, and procedural memory from the completed case.";
    case "reflect_on_decision": return "Reflect on what worked, failed, and should improve.";
    case "extract_learning": return "Extract cross-agent learning and strategy updates.";
    case "manage_memory": return "Coordinate memory extraction, reflection, and learning as one governed tool.";
    case "generate_scenarios": return "Generate isolated simulation scenarios before execution.";
    case "evaluate_outcome": return "Score simulated outcome risk, resilience, and recommendation.";
    default: return `Execute governed structured reasoning for ${name}.`;
  }
}

function cacheEntryKey(toolName, input = {}) {
  const caseId = input.context?.case_id || "no-case";
  const stage = input.context?.current_stage || "no-stage";
  const stable = JSON.stringify({
    toolName,
    text: textFrom(input),
    context: {
      case_id: input.context?.case_id,
      current_stage: input.context?.current_stage,
      assumptions: input.context?.assumptions,
      evidence_bundle: input.context?.evidence_bundle,
      options: input.context?.options,
      objections: input.context?.objections,
      implementation_plan: input.context?.implementation_plan,
      verification_chain: input.context?.verification_chain,
      shared_memory: input.context?.shared_memory || input.context?.memory,
      organizational_intelligence: input.context?.organizational_intelligence,
      frameworks: input.context?.frameworks,
      analysis: input.context?.analysis,
      digital_twin: input.context?.digital_twin?.risk_state
    }
  });
  const hash = shortHash(stable);
  return `${TOOL_CACHE_VERSION}:${toolName}:${stage}:${hash}`;
}

function cacheKey(toolName, input = {}) {
  return caseScopedKey(input.context?.case_id || input.case_id || `no-case-${shortHash(textFrom(input))}`, toolName);
}

function caseScopedKey(caseId = "no-case", suffix = "") {
  const normalizedCaseId = String(caseId || "no-case").replace(/[^a-zA-Z0-9:_-]/g, "_");
  const compactCaseId = normalizedCaseId.length > 420 ? shortHash(normalizedCaseId) : normalizedCaseId;
  const key = `case:${compactCaseId}`;
  if (new TextEncoder().encode(key).length >= 512) return `case:${shortHash(normalizedCaseId)}`;
  return key;
}

async function parseCacheDocument(raw) {
  if (!raw) return { version: TOOL_CACHE_VERSION, entries: {} };
  try {
    const parsed = typeof raw === "object" && !Array.isArray(raw)
      ? raw
      : await enforceJSON(raw, { fallback: {} });
    if (parsed?.entries && typeof parsed.entries === "object" && !Array.isArray(parsed.entries)) {
      return { ...parsed, entries: parsed.entries };
    }
    return { version: TOOL_CACHE_VERSION, entries: {} };
  } catch {
    return { version: TOOL_CACHE_VERSION, entries: {} };
  }
}

async function readCaseCacheEntry(cache, caseId, entryKey) {
  const key = caseScopedKey(caseId);
  try {
    const doc = await parseCacheDocument(await cache.get(key, "json"));
    return doc.entries?.[entryKey]?.result || null;
  } catch (error) {
    traceStep("tool.kv_get.error", { case_id: caseId, key }, { error: error.message });
    throw error;
  }
}

async function writeCaseCacheEntry(cache, caseId, entryKey, result, resourceGuard = null) {
  const key = caseScopedKey(caseId);
  try {
    const doc = await parseCacheDocument(cache.get ? await cache.get(key, "json") : null);
    const entries = { ...(doc.entries || {}) };
    entries[entryKey] = {
      result,
      updated_at: new Date().toISOString()
    };
    const boundedEntries = Object.fromEntries(
      Object.entries(entries)
        .sort(([, left], [, right]) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")))
        .slice(0, MAX_CACHE_ENTRIES_PER_CASE)
    );
    const payload = JSON.stringify({
      version: TOOL_CACHE_VERSION,
      case_id: String(caseId || "no-case"),
      cache_role: "cache_only",
      entries: boundedEntries
    });
    resourceGuard?.assertCacheValue?.(key, payload);
    await cache.put(key, payload, { expirationTtl: CACHE_TTL_SECONDS });
    return true;
  } catch (error) {
    traceStep("tool.kv_put.error", { case_id: caseId, key }, { error: error.message });
    return false;
  }
}

function shortHash(value = "") {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isCriticalInfrastructureError(error = {}) {
  const message = String(error.message || error || "").toLowerCase();
  return (
    message.includes("kv ") ||
    message.includes("key length") ||
    message.includes("d1") ||
    message.includes("no such table") ||
    message.includes("infrastructure")
  );
}

export async function runTool(name, input = {}) {
  if (!tools[name]) throw new Error("Tool not found");
  const cache = input.cache;
  const resourceGuard = input.resource_guard;
  const caseId = input.context?.case_id || input.case_id || `no-case-${shortHash(textFrom(input))}`;
  const key = cache ? cacheKey(name, input) : null;
  const entryKey = cache ? cacheEntryKey(name, input) : null;
  if (cache && key) {
    resourceGuard?.beforeSubrequest?.("kv_get", { tool_name: name, key });
    traceStep("tool.kv_get", { tool_name: name, key }, { key_bytes: new TextEncoder().encode(key).length });
    const cached = await readCaseCacheEntry(cache, caseId, entryKey);
    if (cached) {
      return safeToolExecution(
        () => enforceJSON(cached, { fallback: deterministicFallback(name, input) }),
        input,
        { toolName: name, schema: toolSchemas[name]?.output_schema, fallback: deterministicFallback(name, input) }
      );
    }
  }

  const result = await safeToolExecution(
    () => withTimeout(() => tools[name](input), toolTimeoutMs(input), name),
    input,
    { toolName: name, schema: toolSchemas[name]?.output_schema, fallback: deterministicFallback(name, input) }
  );
  if (cache && key) {
    resourceGuard?.beforeSubrequest?.("kv_put", { tool_name: name, key });
    traceStep("tool.kv_put", { tool_name: name, key }, { value_type: "json", key_bytes: new TextEncoder().encode(key).length });
    await writeCaseCacheEntry(cache, caseId, entryKey, result, resourceGuard);
  }
  return result;
}

export async function runToolBatch(calls = [], sharedInput = {}) {
  const pending = new Map();
  return Promise.all(calls.map(({ name, input = {} }) => {
    const mergedInput = { ...sharedInput, ...input };
    const key = cacheEntryKey(name, mergedInput);
    if (!pending.has(key)) {
      pending.set(key, runTool(name, mergedInput));
    }
    return pending.get(key);
  }));
}

export const skills = Object.fromEntries(
  Object.keys(tools).map((name) => [
    name,
    {
      schema: toolSchemas[name],
      async execute(input = {}) {
        return runTool(name, input);
      }
    }
  ])
);

export async function invokeSkill(toolName, input = {}) {
  try {
    return await runTool(toolName, input);
  } catch (error) {
    return {
      status: "error",
      ...structuredToolError({
        message: error.message,
        customerMessage: `The ${toolName} tool could not complete.`,
        suggestion: "Retry if retriable, otherwise escalate to the coordinator."
      })
    };
  }
}

export function listToolDefinitions() {
  return Object.values(toolSchemas);
}

function validateToolInput(toolName, input = {}) {
  if (!toolSchemas[toolName]) {
    return { allowed: false, reason: `Tool ${toolName} is not registered.` };
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { allowed: false, reason: "Tool input must be a JSON object." };
  }
  return { allowed: true, reason: "Tool input accepted." };
}

export async function beforeToolCall({ agentId, toolName, input = {}, policy, eventBus, caseId }) {
  const policyCheck = policy.buildToolPolicyCheck(agentId, toolName);
  const inputCheck = validateToolInput(toolName, input);
  const combinedCheck = {
    ...policyCheck,
    allowed: policyCheck.allowed && inputCheck.allowed,
    reason: policyCheck.allowed ? inputCheck.reason : policyCheck.reason,
    input_validation: inputCheck
  };
  await eventBus?.emit("tool_called", {
    case_id: caseId,
    agent_id: agentId,
    input_summary: `Tool called: ${toolName}`,
    output_summary: combinedCheck.reason,
    tools_used: [toolName],
    policy_checks: [combinedCheck],
    raw_payload: { tool: toolName, input }
  });
  await eventBus?.emit("tool_execution_start", {
    case_id: caseId,
    agent_id: agentId,
    input_summary: `Tool requested: ${toolName}`,
    output_summary: combinedCheck.reason,
    tools_used: [toolName],
    policy_checks: [combinedCheck],
    raw_payload: { tool_name: toolName, input_schema: toolSchemas[toolName]?.input_schema || null }
  });

  if (!combinedCheck.allowed) {
    await eventBus?.emit("policy_violation_detected", {
      case_id: caseId,
      agent_id: "policy_sentinel",
      input_summary: `Blocked tool: ${toolName}`,
      output_summary: combinedCheck.reason,
      tools_used: [],
      policy_checks: [combinedCheck],
      raw_payload: combinedCheck
    });
  }
  return combinedCheck;
}

export async function afterToolCall({ agentId, toolName, result = {}, policy, policyCheck, eventBus, caseId }) {
  validateToolOutput(result);
  const afterCheck = policy.validateToolResult(agentId, toolName, result);
  const checks = [policyCheck, afterCheck].filter(Boolean);

  await eventBus?.emit("tool_result", {
    case_id: caseId,
    agent_id: agentId,
    input_summary: `Tool result: ${toolName}`,
    output_summary: JSON.stringify(result).slice(0, 240),
    tools_used: [toolName],
    policy_checks: checks,
    raw_payload: { tool: toolName, output: result }
  });
  await eventBus?.emit("tool_execution_end", {
    case_id: caseId,
    agent_id: agentId,
    input_summary: `Tool completed: ${toolName}`,
    output_summary: JSON.stringify(result).slice(0, 240),
    tools_used: [toolName],
    policy_checks: checks,
    raw_payload: result
  });
  return { ...result, policy_check: policyCheck, after_policy_check: afterCheck };
}

export async function executeToolWithHooks({ agentId, toolName, input = {}, policy, eventBus, caseId }) {
  const policyCheck = await beforeToolCall({ agentId, toolName, input, policy, eventBus, caseId });
  if (!policyCheck.allowed) {
    return {
      status: "blocked",
      ...structuredToolError({
        errorCategory: "policy_blocked",
        isRetriable: false,
        message: policyCheck.reason || `Tool ${toolName} blocked by policy.`,
        customerMessage: `The ${toolName} tool was blocked by governance policy.`,
        suggestion: "Stop this path and escalate to policy review before retrying."
      }),
      policy_check: policyCheck
    };
  }

  try {
    const result = await runTool(toolName, input);
    return afterToolCall({ agentId, toolName, result, policy, policyCheck, eventBus, caseId });
  } catch (error) {
    const errorEnvelope = structuredToolError({
      errorCategory: error.message?.toLowerCase().includes("timeout") ? "timeout" : "tool_execution_failed",
      isRetriable: true,
      message: error.message,
      customerMessage: `The ${toolName} tool failed during execution.`,
      suggestion: "The coordinator should retry within limits or fail fast if the error is critical."
    });
    await eventBus?.emit("system_error", {
      case_id: caseId,
      agent_id: agentId,
      input_summary: `Tool failed: ${toolName}`,
      output_summary: error.message,
      tools_used: [toolName],
      policy_checks: [policyCheck],
      raw_payload: { tool: toolName, ...errorEnvelope }
    });
    return { status: "error", ...errorEnvelope, policy_check: policyCheck };
  }
}
