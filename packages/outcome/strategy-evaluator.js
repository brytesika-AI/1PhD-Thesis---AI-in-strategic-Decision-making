import { callLLM } from "../llm/llm-router.js";
import { clampNumber, parseJSONObject } from "./json-utils.js";

function fallbackEvaluation(strategy = {}, simulation = {}) {
  const success = clampNumber(Number(simulation.success_probability || 0) * 100, 0, 100);
  const risk = clampNumber(100 - Number(simulation.risk_score || 0) * 100, 0, 100);
  const resilience = clampNumber(Number(simulation.resilience_score || simulation.resilience || 0) * 100, 0, 100);
  const impact = clampNumber((success + resilience) / 2, 0, 100);
  const overall = clampNumber((success + risk + impact + resilience) / 4, 0, 100);
  return {
    scores: {
      feasibility: Number(success.toFixed(2)),
      risk: Number(risk.toFixed(2)),
      impact: Number(impact.toFixed(2)),
      resilience: Number(resilience.toFixed(2))
    },
    overall_score: Number(overall.toFixed(2)),
    justification: `${strategy.name || "This strategy"} is judged from simulation metrics because LLM evaluation returned no usable score.`
  };
}

function normalizeEvaluation(parsed = {}, fallback) {
  const scores = parsed.scores || {};
  const normalized = {
    scores: {
      feasibility: clampNumber(scores.feasibility ?? fallback.scores.feasibility),
      risk: clampNumber(scores.risk ?? fallback.scores.risk),
      impact: clampNumber(scores.impact ?? fallback.scores.impact),
      resilience: clampNumber(scores.resilience ?? fallback.scores.resilience)
    },
    overall_score: clampNumber(parsed.overall_score ?? fallback.overall_score),
    justification: String(parsed.justification || fallback.justification).slice(0, 900)
  };
  if (!Number.isFinite(Number(parsed.overall_score))) {
    const values = Object.values(normalized.scores);
    normalized.overall_score = Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2));
  }
  return normalized;
}

export async function evaluateStrategy(strategy, simulation, goal, env = {}) {
  const fallback = fallbackEvaluation(strategy, simulation);
  const prompt = `
Evaluate this strategy:

Goal: ${goal}
Strategy: ${JSON.stringify(strategy)}
Simulation: ${JSON.stringify(simulation)}

Score from 0-100:

- feasibility
- risk management
- strategic impact
- resilience

Return JSON:
{
  "scores": {
    "feasibility": number,
    "risk": number,
    "impact": number,
    "resilience": number
  },
  "overall_score": number,
  "justification": "..."
}
`;

  const raw = await callLLM({ task: "evaluation", prompt, temperature: 0, env });
  return normalizeEvaluation(parseJSONObject(raw, fallback), fallback);
}
