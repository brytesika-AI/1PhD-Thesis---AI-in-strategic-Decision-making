import { runSimulation } from "../simulation/simulation-engine.js";
import { GlobalIntelligenceStore } from "../intelligence/global-intelligence-store.js";
import { deriveCaseType } from "../memory/d1-memory-store.js";
import { learningSignalsForCase } from "../learning/outcome-learning-loop.js";
import { computeScore } from "./scoring-engine.js";
import { generateStrategies } from "./strategy-generator.js";
import { evaluateStrategy } from "./strategy-evaluator.js";

export async function runOutcomeEngine(state, env = {}) {
  const goal = state.case_description || state.user_goal || state.text || "";
  const caseType = deriveCaseType(goal);
  const globalStore = new GlobalIntelligenceStore(env.DB);
  const [globalInsights, learningSignals] = await Promise.all([
    globalStore.retrieveHighImpactInsights({ goal, caseType, limit: 3 }),
    learningSignalsForCase({ caseState: state, env, limit: 3 })
  ]);
  const strategies = await generateStrategies(goal, env);
  const results = [];

  for (const strategy of strategies) {
    const simulation = await runSimulation({
      ...state,
      proposed_strategy: strategy,
      simulation_isolated: true
    }, env);
    const evaluation = await evaluateStrategy(strategy, simulation, goal, env);
    const score = computeScore(simulation, evaluation, {
      strategy,
      globalInsights,
      learningSignals
    });
    results.push({
      strategy,
      simulation,
      evaluation,
      score: Number(score.toFixed(2))
    });
  }

  const ranked = results.sort((a, b) => b.score - a.score);
  if (!ranked.length) {
    throw new Error("Outcome engine could not validate any strategy.");
  }

  return {
    goal,
    strategies_tested: results.length,
    ranked_strategies: ranked,
    recommended_strategy: ranked[0].strategy,
    confidence: ranked[0].score,
    validation_summary: ranked[0].evaluation.justification,
    system_learning_insight: learningSignals.private_lessons[0]?.lesson || "No prior real-world outcome feedback for this organization yet.",
    global_intelligence_insight: globalInsights[0]?.lesson || "No anonymized global intelligence pattern matched this decision yet.",
    global_intelligence_used: globalInsights,
    learning_adjustment: learningSignals.adjustment
  };
}
