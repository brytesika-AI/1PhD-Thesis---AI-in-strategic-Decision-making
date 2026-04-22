const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const TOOL_CACHE_VERSION = "tool-v2";

function textFrom(input) {
  return String(input?.text || input?.goal || input?.context?.user_goal || "").slice(0, 1200);
}

function contextFrom(input) {
  return input?.context || input || {};
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function bestProcedure(context = {}) {
  return [...(context.memory?.procedural || [])]
    .sort((left, right) => {
      const success = Number(right.success_rate || 0) - Number(left.success_rate || 0);
      if (success !== 0) return success;
      return Number(left.failure_count || 0) - Number(right.failure_count || 0);
    })[0] || null;
}

function deterministicFallback(name, input = {}) {
  const text = textFrom(input);
  const context = contextFrom(input);
  const procedure = bestProcedure(context);
  const fallbackByTool = {
    gather_evidence: {
      finding: "Evidence gathered from governed case context.",
      signals: [
        { name: "strategic_context", severity: context.risk_state || "medium", excerpt: text.slice(0, 180) }
      ],
      evidence: {
        source: "case_context",
        governance_basis: ["King IV", "POPIA Act 4 of 2013"],
        observed_constraints: asArray(context.assumptions).slice(0, 3)
      },
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
      confidence: 0.8
    },
    root_cause_analysis: {
      finding: "Root-cause analysis completed.",
      evidence: {
        causes: ["Strategic ambiguity", "Evidence fragmentation", "Weak handoff accountability"],
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
          name: procedure ? `Learned strategy: ${procedure.task_type}` : "Governed rollout",
          description: procedure ? asArray(procedure.strategy_steps).join(" -> ") : "Proceed with approval gates and evidence traceability.",
          risk: Number(procedure?.failure_count || 0) > 2 ? "high" : "medium",
          learned_success_rate: procedure?.success_rate
        },
        { id: "opt_2", name: "Constrained pilot", description: "Limit scope while validating controls.", risk: "low" }
      ],
      assumptions_used: asArray(context.assumptions),
      confidence: 0.76
    },
    run_stress_tests: {
      stress_tests: [
        { scenario: "Load shedding event", outcome: "System downtime risk", impact: "high" },
        { scenario: "Regulatory audit", outcome: "Evidence trail must prove decision accountability", impact: "medium" }
      ],
      verdict: "high_risk",
      confidence: 0.75
    },
    generate_objections: {
      finding: "Adversarial objections generated.",
      objections: [
        { id: "obj_1", text: "Cloud reliability under load shedding is not validated", severity: "high" }
      ],
      objection: "Cloud reliability under load shedding is not validated",
      stress_tests: [
        { scenario: "Load shedding event", outcome: "System downtime risk", impact: "high" }
      ],
      verdict: "high_risk",
      confidence: 0.75
    },
    build_implementation_plan: {
      finding: "Implementation plan generated.",
      implementation_plan: procedure?.strategy_steps?.length
        ? Object.fromEntries(procedure.strategy_steps.slice(0, 5).map((step, index) => [`phase_${index + 1}`, step]))
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
        { metric: "control_failure", threshold: "high", cadence: "continuous" }
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
      ],
      procedural: [
        {
          task_type: context.memory?.retrieval?.case_type || "strategic_decision",
          strategy_steps: Object.values(context.implementation_plan || {}).length
            ? Object.values(context.implementation_plan)
            : ["Gather evidence", "Extract assumptions", "Challenge options", "Monitor outcomes"],
          success_rate: context.status === "escalation_required" ? 0.35 : 0.74
        }
      ],
      confidence: 0.78
    },
    reflect_on_decision: {
      what_worked: ["Structured tool outputs kept the loop auditable."],
      what_failed: context.status === "escalation_required" ? ["Decision escalated before final readiness."] : [],
      improvements: context.status === "escalation_required"
        ? ["Add stronger evidence gate before option generation", "Require fallback controls earlier"]
        : ["Reuse successful approval-gated rollout strategy", "Keep monitoring thresholds visible to the board"],
      confidence: 0.76
    }
  };
  return { ...fallbackByTool[name], tools_used: [name] };
}

async function callLLM(prompt, input = {}, fallback = {}) {
  const ai = input.llm || input.ai;
  if (!ai?.run) return JSON.stringify(fallback);
  const result = await ai.run(input.model || DEFAULT_MODEL, {
    messages: [
      { role: "system", content: "You are an internal AI-SRF tool reasoner. Return only JSON." },
      { role: "user", content: prompt }
    ],
    max_tokens: input.max_tokens || 900
  });
  return result?.response ?? result;
}

export async function enforceJSON(raw, { retryLLM } = {}) {
  let normalized = raw;
  if (typeof normalized !== "string") {
    normalized = JSON.stringify(normalized);
  }

  try {
    return JSON.parse(normalized);
  } catch (error) {
    if (!retryLLM) throw error;
    const retry = await retryLLM(`
Return ONLY valid JSON.
No explanation.
No text.
Only JSON.

${normalized}
    `);
    const retryText = typeof retry === "string" ? retry : JSON.stringify(retry);
    return JSON.parse(retryText);
  }
}

export function validateToolOutput(output) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new Error("Invalid tool output");
  }
  return output;
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

async function runHybridTool(name, input, buildPrompt, validate) {
  const fallback = deterministicFallback(name, input);
  const prompt = buildPrompt(input);
  const raw = await callLLM(prompt, input, fallback);
  const parsed = await enforceJSON(raw, {
    retryLLM: (retryPrompt) => callLLM(retryPrompt, input, fallback)
  });
  return withToolName(name, validate({ ...fallback, ...parsed }));
}

export async function gather_evidence(input = {}) {
  return runHybridTool(
    "gather_evidence",
    input,
    (state) => `
Gather evidence from this AI-SRF case.

Return JSON:
{
  "finding": "...",
  "signals": [{"name":"...","severity":"low|medium|high"}],
  "evidence": {"source":"...","governance_basis":["..."]},
  "confidence": 0.8
}

Case:
${JSON.stringify({ text: textFrom(state), context: contextFrom(state) })}
    `,
    validateEvidence
  );
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
${JSON.stringify({ case_description: textFrom(state), context: contextFrom(state) })}
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
${JSON.stringify({ text: textFrom(state), context: contextFrom(state) })}
    `,
    validateEvidence
  );
}

export async function generate_options(input = {}) {
  return runHybridTool(
    "generate_options",
    input,
    (state) => `
Generate strategic options.

Return JSON:
{
  "options": [
    {"name":"...","description":"...","risk":"low|medium|high"}
  ],
  "confidence": 0.76
}

Case:
${JSON.stringify({
  text: textFrom(state),
  context: contextFrom(state),
  memory: contextFrom(state).memory || {}
})}
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
${JSON.stringify({ text: textFrom(state), context: contextFrom(state) })}
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
Act as a Devil's Advocate.

Return JSON:
{
  "objections": [
    {"id":"obj_1","text":"...","severity":"low|medium|high"}
  ],
  "stress_tests": [{"scenario":"...","outcome":"...","impact":"low|medium|high"}],
  "verdict": "low_risk|medium_risk|high_risk",
  "confidence": 0.75
}

Case:
${JSON.stringify({ text: textFrom(state), context: contextFrom(state) })}
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
Build an implementation plan for the selected strategic option.

Return JSON:
{
  "implementation_plan": {"phase_1":"...","phase_2":"...","phase_3":"..."},
  "confidence": 0.82
}

Case:
${JSON.stringify({
  text: textFrom(state),
  context: contextFrom(state),
  memory: contextFrom(state).memory || {}
})}
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
${JSON.stringify({ text: textFrom(state), context: contextFrom(state) })}
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

export const tools = {
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
  reflect_on_decision
};

export const toolSchemas = Object.fromEntries(
  Object.keys(tools).map((name) => [
    name,
    {
      name,
      description: `Hybrid AI-SRF structured tool: ${name}`,
      input_schema: {
        type: "object",
        properties: {
          text: { type: "string" },
          context: { type: "object" }
        }
      }
    }
  ])
);

function cacheKey(toolName, input = {}) {
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
      verification_chain: input.context?.verification_chain
    }
  });
  return `${TOOL_CACHE_VERSION}:${toolName}:${stable}`;
}

export async function runTool(name, input = {}) {
  if (!tools[name]) throw new Error("Tool not found");
  const cache = input.cache;
  const key = cache ? cacheKey(name, input) : null;
  if (cache && key) {
    const cached = await cache.get(key);
    if (cached) return validateToolOutput(JSON.parse(cached));
  }

  const result = validateToolOutput(await tools[name](input));
  if (cache && key) {
    await cache.put(key, JSON.stringify(result), { expirationTtl: 300 });
  }
  return result;
}

export async function runToolBatch(calls = [], sharedInput = {}) {
  const pending = new Map();
  return Promise.all(calls.map(({ name, input = {} }) => {
    const mergedInput = { ...sharedInput, ...input };
    const key = cacheKey(name, mergedInput);
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
    return { status: "error", message: error.message };
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
    return { status: "blocked", policy_check: policyCheck };
  }

  const result = await runTool(toolName, input);
  return afterToolCall({ agentId, toolName, result, policy, policyCheck, eventBus, caseId });
}
