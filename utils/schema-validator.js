function extractJsonCandidate(value) {
  const text = String(value ?? "").trim();
  if (!text) return text;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (objectStart >= 0 && objectEnd > objectStart) return text.slice(objectStart, objectEnd + 1);
  if (arrayStart >= 0 && arrayEnd > arrayStart) return text.slice(arrayStart, arrayEnd + 1);
  return text;
}

function parseMaybeNestedJson(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  let candidate = String(value ?? "").trim();
  for (let depth = 0; depth < 3; depth += 1) {
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch (error) {
      parsed = JSON.parse(extractJsonCandidate(candidate));
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    if (typeof parsed !== "string") return parsed;
    candidate = extractJsonCandidate(parsed);
  }
  throw new Error("Invalid JSON");
}

export async function enforceJSON(raw, { retryLLM, retry, attempts = 3, fallback = null } = {}) {
  let current = raw;
  let lastError = null;
  const retryFn = retryLLM || retry;
  const maxAttempts = Math.max(1, Number(attempts || 3));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return parseMaybeNestedJson(current);
    } catch (error) {
      lastError = error;
      if (!retryFn || attempt === maxAttempts) break;
      current = await retryFn(`
Return ONLY valid JSON.
No prose.
No markdown.
No JavaScript object stringification.

Invalid payload:
${String(current)}
      `);
    }
  }

  if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) return fallback;
  throw new Error(`Invalid JSON${lastError?.message ? `: ${lastError.message}` : ""}`);
}

export const TOOL_OUTPUT_SCHEMAS = {
  gather_evidence: {
    required: { evidence: "array", confidence: "number" },
    optional: { signals: "array", finding: "string" }
  },
  extract_assumptions: {
    required: { assumptions: "array", confidence: "number" },
    optional: { diagnostic_questions: "array" }
  },
  root_cause_analysis: {
    required: { evidence: "object", confidence: "number" },
    optional: { compliance_verdict: "string", finding: "string" }
  },
  generate_options: {
    required: { options: "array", confidence: "number" },
    optional: { memory_used: "object" }
  },
  generate_objections: {
    required: { objections: "array", stress_tests: "array", verdict: "string", confidence: "number" }
  },
  run_stress_tests: {
    required: { stress_tests: "array", verdict: "string", confidence: "number" }
  },
  build_implementation_plan: {
    required: { implementation_plan: "object", confidence: "number" }
  },
  generate_monitoring_rules: {
    required: { risk_signals: "array", monitoring_rules: "array", alert_thresholds: "array", confidence: "number" }
  },
  validate_policy: {
    required: { confirmed: "boolean", confidence: "number" }
  },
  validate_consensus: {
    required: { confirmed: "boolean", final_rationale: "string", confidence: "number" }
  },
  extract_memory: {
    required: { episodic: "array", semantic: "array", procedural: "array", confidence: "number" }
  },
  reflect_on_decision: {
    required: { what_worked: "array", what_failed: "array", improvements: "array", confidence: "number" }
  },
  extract_learning: {
    required: { lessons: "array", improvements: "array", strategy_updates: "array", agent_learning: "object", confidence: "number" }
  },
  manage_memory: {
    required: { memory: "object", reflection: "object", learning: "object", confidence: "number" }
  },
  generate_scenarios: {
    required: { scenarios: "array", confidence: "number" }
  },
  evaluate_outcome: {
    required: {
      scenario: "string",
      risk_score: "number",
      success_probability: "number",
      key_failures: "array",
      recommendation: "string",
      confidence: "number"
    },
    optional: { resilience: "number" },
    enum: { recommendation: ["proceed", "modify", "reject"] }
  },
  run_porters_five_forces: {
    required: {
      competitive_rivalry: "string",
      supplier_power: "string",
      buyer_power: "string",
      threat_of_substitution: "string",
      threat_of_new_entry: "string",
      overall_industry_attractiveness: "string",
      confidence: "number"
    },
    enum: { overall_industry_attractiveness: ["low", "medium", "high"] }
  },
  run_swot_analysis: {
    required: { strengths: "array", weaknesses: "array", opportunities: "array", threats: "array", confidence: "number" }
  },
  run_pestle_analysis: {
    required: {
      political: "array",
      economic: "array",
      social: "array",
      technological: "array",
      legal: "array",
      environmental: "array",
      confidence: "number"
    },
    optional: { highlights: "array" }
  },
  run_value_chain_analysis: {
    required: {
      inbound_logistics: "array",
      operations: "array",
      outbound_logistics: "array",
      marketing_sales: "array",
      service: "array",
      support_activities: "object",
      bottlenecks: "array",
      confidence: "number"
    }
  },
  run_scenario_planning: {
    required: { scenarios: "array", critical_uncertainties: "array", preferred_posture: "string", confidence: "number" }
  }
};

export function validateBaseToolOutput(output) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new Error("Invalid tool output: expected JSON object");
  }
  return output;
}

function checkType(value, expected) {
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") return value && typeof value === "object" && !Array.isArray(value);
  return typeof value === expected;
}

export function validateSchema(result, schema = {}, { toolName = "tool" } = {}) {
  validateBaseToolOutput(result);
  const required = schema.required || {};
  for (const [field, expected] of Object.entries(required)) {
    if (!(field in result)) throw new Error(`${toolName} missing required field: ${field}`);
    if (!checkType(result[field], expected)) throw new Error(`${toolName} invalid field type: ${field} must be ${expected}`);
  }
  const optional = schema.optional || {};
  for (const [field, expected] of Object.entries(optional)) {
    if (field in result && result[field] != null && !checkType(result[field], expected)) {
      throw new Error(`${toolName} invalid optional field type: ${field} must be ${expected}`);
    }
  }
  for (const [field, allowed] of Object.entries(schema.enum || {})) {
    if (field in result && !allowed.includes(result[field])) {
      throw new Error(`${toolName} invalid enum value: ${field}`);
    }
  }
  return result;
}

export function validateToolResult(toolName, result, schema = TOOL_OUTPUT_SCHEMAS[toolName]) {
  return validateSchema(result, schema, { toolName });
}

export async function safeTool(tool, state = {}) {
  try {
    const result = await tool(state);
    const parsed = await enforceJSON(result);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid tool output");
    }
    return parsed;
  } catch (error) {
    return {
      error: true,
      message: error.message
    };
  }
}

export async function safeToolExecution(tool, state = {}, { toolName = "tool", schema = TOOL_OUTPUT_SCHEMAS[toolName], fallback = null, logger = null } = {}) {
  try {
    const raw = await tool(state);
    const parsed = await enforceJSON(raw, { fallback, attempts: 3 });
    return validateToolResult(toolName, parsed, schema);
  } catch (error) {
    await logger?.({
      level: "error",
      event_type: "tool_error",
      tool_name: toolName,
      message: error.message
    });
    if (fallback) return validateToolResult(toolName, fallback, schema);
    throw error;
  }
}
