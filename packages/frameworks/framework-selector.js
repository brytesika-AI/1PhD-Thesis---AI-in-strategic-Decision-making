const FRAMEWORK_TO_TOOL = {
  porters_five_forces: "run_porters_five_forces",
  swot: "run_swot_analysis",
  pestle: "run_pestle_analysis",
  value_chain: "run_value_chain_analysis",
  scenario_planning: "run_scenario_planning"
};

const PROBLEM_TYPE_TO_FRAMEWORK = {
  industry: "porters_five_forces",
  internal: "swot",
  macro: "pestle",
  operational: "value_chain",
  uncertainty: "scenario_planning"
};

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textFromState(state = {}) {
  return [
    state.case_description,
    state.user_goal,
    state.text,
    state.decision_type,
    state.risk_state,
    state.loop?.risk_state,
    state.digital_twin?.risk_state?.level,
    JSON.stringify(state.digital_twin?.risk_state?.signals || [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function increment(scores, framework, amount, reason, reasons) {
  scores[framework] = Number((Number(scores[framework] || 0) + amount).toFixed(3));
  if (reason) reasons.push(reason);
}

function scoreFromKeywords(state = {}) {
  const text = textFromState(state);
  const scores = {
    porters_five_forces: 0,
    swot: 0,
    pestle: 0,
    value_chain: 0,
    scenario_planning: 0
  };
  const reasons = [];

  if (/(competition|competitor|industry|market dynamics|market share|buyer|supplier|substitution|new entrant|rivalry)/i.test(text)) {
    increment(scores, "porters_five_forces", 0.45, "industry competition or market dynamics detected", reasons);
  }
  if (/(strength|weakness|opportunit|threat|capabilit|internal|resource|gap)/i.test(text)) {
    increment(scores, "swot", 0.4, "internal strengths, weaknesses, opportunities, or threats detected", reasons);
  }
  if (/(regulat|compliance|econom|currency|technology|politic|legal|social|environment|popia|king iv|load shedding)/i.test(text)) {
    increment(scores, "pestle", 0.45, "macro, regulatory, economic, technology, legal, or environmental factors detected", reasons);
  }
  if (/(operation|process|workflow|supply chain|value chain|implementation|handoff|uptime|infrastructure|sla|vendor)/i.test(text)) {
    increment(scores, "value_chain", 0.42, "operations, process, vendor, or implementation constraints detected", reasons);
  }
  if (/(uncertain|risk|scenario|future|volatility|shock|stress|simulate|forecast|contingency|resilience)/i.test(text)) {
    increment(scores, "scenario_planning", 0.45, "uncertainty, risk, future scenario, or resilience language detected", reasons);
  }

  const twinLevel = state.digital_twin?.risk_state?.level || state.loop?.risk_state || state.risk_state;
  if (["high", "critical", "ELEVATED"].includes(String(twinLevel))) {
    increment(scores, "scenario_planning", 0.18, "elevated risk state increases scenario-planning priority", reasons);
    increment(scores, "pestle", 0.08, "elevated external risk increases PESTLE priority", reasons);
  }

  return { scores, reasons };
}

function scoreFromMemory(state = {}) {
  const scores = {};
  const procedural = [
    ...asArray(state.shared_memory?.procedural),
    ...asArray(state.memory?.procedural)
  ];
  for (const item of procedural) {
    const framework = item.framework || item.content?.framework || String(item.task_type || "").replace(/^framework_/, "");
    if (!FRAMEWORK_TO_TOOL[framework]) continue;
    const successRate = Number(item.success_rate ?? item.content?.success_rate ?? 0);
    if (successRate > 0) scores[framework] = Math.max(Number(scores[framework] || 0), successRate * 0.18);
  }
  return scores;
}

async function classifyProblemType(state = {}, ai = null) {
  if (!ai?.run) return null;
  const prompt = `
Classify this decision problem into exactly one type:
- industry
- internal
- macro
- operational
- uncertainty

Return JSON:
{
  "problem_type": "...",
  "confidence": 0.0
}

Case:
${JSON.stringify({
  case_description: state.case_description || state.user_goal || state.text || "",
  risk_state: state.risk_state || state.loop?.risk_state || state.digital_twin?.risk_state || null,
  decision_type: state.decision_type || null
})}
  `;
  try {
    const raw = await ai.run(state.model || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        { role: "system", content: "Classify the strategic decision problem. Return only JSON." },
        { role: "user", content: prompt }
      ],
      max_tokens: 200
    });
    const parsed = JSON.parse(raw?.response || raw);
    if (!PROBLEM_TYPE_TO_FRAMEWORK[parsed.problem_type]) return null;
    return {
      problem_type: parsed.problem_type,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence || 0)))
    };
  } catch {
    return null;
  }
}

export function frameworkToolFor(framework) {
  return FRAMEWORK_TO_TOOL[framework] || null;
}

export async function selectFrameworks(state = {}, { ai = null } = {}) {
  const keyword = scoreFromKeywords(state);
  const memoryScores = scoreFromMemory(state);
  const scores = { ...keyword.scores };
  const reasons = [...keyword.reasons];

  for (const [framework, score] of Object.entries(memoryScores)) {
    increment(scores, framework, score, `${framework} has prior procedural success memory`, reasons);
  }

  const classification = await classifyProblemType(state, ai);
  if (classification) {
    const framework = PROBLEM_TYPE_TO_FRAMEWORK[classification.problem_type];
    increment(scores, framework, classification.confidence * 0.35, `LLM classified problem as ${classification.problem_type}`, reasons);
  }

  const ranked = Object.entries(scores)
    .map(([framework, score]) => ({ framework, score }))
    .sort((left, right) => right.score - left.score);
  const selected = ranked.filter((item) => item.score > 0.05);
  const fallback = selected.length ? selected : [
    { framework: "swot", score: 0.25 },
    { framework: "scenario_planning", score: 0.22 }
  ];
  const primary = fallback[0].framework;
  const secondary = fallback
    .slice(1)
    .filter((item) => item.framework !== primary)
    .slice(0, 3)
    .map((item) => item.framework);

  return {
    primary_framework: primary,
    secondary_frameworks: secondary,
    justification: reasons.length ? reasons.slice(0, 4).join("; ") : "Defaulted to SWOT + Scenario Planning for repeatable structured analysis.",
    classification: classification || { problem_type: "rule_based", confidence: 0.7 },
    ranked_frameworks: fallback,
    tool_names: [primary, ...secondary].map(frameworkToolFor).filter(Boolean)
  };
}
