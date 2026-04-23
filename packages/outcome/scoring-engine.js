function strategyPattern(strategy = {}) {
  const text = `${strategy.name || ""} ${strategy.description || ""} ${strategy.approach || ""}`.toLowerCase();
  if (text.includes("pilot") || text.includes("phased") || text.includes("stage")) return "phased_governed_rollout";
  if (text.includes("resilience") || text.includes("continuity") || text.includes("harden")) return "resilience_first";
  if (text.includes("sprint") || text.includes("focused") || text.includes("quick")) return "focused_value_sprint";
  return "governed_strategy";
}

function learningModifier(strategy = {}, context = {}) {
  const pattern = strategyPattern(strategy);
  const privateLessons = context.learningSignals?.private_lessons || [];
  const globalInsights = context.globalInsights || [];
  const privateAdjustment = Number(context.learningSignals?.adjustment || 0);
  const globalAdjustment = globalInsights.reduce((total, insight) => {
    const direction = insight.insight_type === "failure_pattern" ? -1 : 1;
    const matches = insight.strategy_pattern === pattern ? 1 : 0.45;
    return total + direction * Number(insight.impact_score || 0) * Number(insight.confidence || 0) * matches * 6;
  }, 0);
  const repeatedFailurePenalty = privateLessons
    .filter((item) => item.outcome === "failure" && String(item.strategy_name || "").toLowerCase().includes(String(strategy.name || "").toLowerCase().slice(0, 12)))
    .length * -5;
  return privateAdjustment + globalAdjustment + repeatedFailurePenalty;
}

export function computeScore(sim, evaluation, context = {}) {
  const base = (
    (Number(evaluation.overall_score || 0) * 0.6) +
    (Number(sim.success_probability || 0) * 20) -
    (Number(sim.risk_score || 0) * 15) +
    (Number(sim.resilience_score || 0) * 5)
  );
  return base + learningModifier(context.strategy || {}, context);
}
