import { callLLM } from "../llm/llm-router.js";
import { parseJSONObject } from "./json-utils.js";

function fallbackStrategies(goal = "") {
  const target = String(goal || "the strategic objective").slice(0, 180);
  return [
    {
      name: "Phased governed rollout",
      description: `Deliver ${target} through a staged rollout with approval gates and monitored controls.`,
      approach: "Start with a constrained pilot, validate evidence, then scale only after governance checks pass.",
      risk: "Execution may move more slowly, but operational and compliance exposure are contained.",
      expected_outcome: "A lower-risk path with clear accountability and measurable learning."
    },
    {
      name: "Resilience-first transformation",
      description: `Prioritize continuity, controls, and failover before expanding ${target}.`,
      approach: "Invest first in resilience controls, monitoring, fallback procedures, and vendor safeguards.",
      risk: "Higher up-front cost and slower benefits realization.",
      expected_outcome: "Improved confidence under stress and fewer failure points during implementation."
    },
    {
      name: "Focused value sprint",
      description: `Pursue the highest-value slice of ${target} with tight delivery scope.`,
      approach: "Select one measurable business outcome, execute quickly, and defer non-critical features.",
      risk: "May under-address broader enterprise dependencies.",
      expected_outcome: "Fast evidence of value with a contained decision surface."
    }
  ];
}

function normalizeStrategies(strategies = [], goal = "") {
  const normalized = strategies
    .filter((item) => item && typeof item === "object")
    .map((item, index) => ({
      name: String(item.name || item.strategy || `Strategy ${index + 1}`).slice(0, 120),
      description: String(item.description || item.summary || item.approach || "").slice(0, 700),
      approach: String(item.approach || item.plan || item.description || "").slice(0, 700),
      risk: String(item.risk || item.risks || "Execution risk requires validation.").slice(0, 400),
      expected_outcome: String(item.expected_outcome || item.outcome || "Improved strategic decision quality.").slice(0, 500)
    }))
    .filter((item) => item.name && item.description);
  const merged = [...normalized, ...fallbackStrategies(goal)];
  const seen = new Set();
  return merged.filter((item) => {
    const key = item.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

export async function generateStrategies(goal, env = {}) {
  const prompt = `
Generate 3-5 distinct strategic options.

Goal:
${goal}

Return JSON:
{
  "strategies": [
    {
      "name": "...",
      "description": "...",
      "approach": "...",
      "risk": "...",
      "expected_outcome": "..."
    }
  ]
}
`;

  const raw = await callLLM({ task: "planning", prompt, temperature: 0.3, env }).catch(() => JSON.stringify({ strategies: fallbackStrategies(goal) }));
  const parsed = parseJSONObject(raw, { strategies: [] });
  const strategies = normalizeStrategies(parsed.strategies, goal);
  if (strategies.length < 3) {
    throw new Error("Outcome engine requires at least 3 strategies.");
  }
  return strategies;
}
