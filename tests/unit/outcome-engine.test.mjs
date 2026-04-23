import assert from "node:assert/strict";
import test from "node:test";

import { callLLM, selectedLLMModel } from "../../packages/llm/llm-router.js";
import { recordOutcomeFeedback } from "../../packages/learning/outcome-learning-loop.js";
import { runOutcomeEngine } from "../../packages/outcome/outcome-engine.js";
import { MockD1, testUser } from "../helpers/mock-cloudflare.mjs";

function outcomeAI() {
  return {
    calls: [],
    async run(model, payload) {
      const prompt = payload.messages.at(-1).content;
      this.calls.push({ model, prompt });
      if (prompt.includes("Generate 3-5 distinct strategic options")) {
        return {
          response: JSON.stringify({
            strategies: [
              { name: "Governed pilot", description: "Pilot the change in a controlled unit.", approach: "Pilot then scale.", risk: "Medium", expected_outcome: "Validated adoption." },
              { name: "Resilience-first rollout", description: "Build continuity controls before scale.", approach: "Harden then expand.", risk: "Low", expected_outcome: "Higher resilience." },
              { name: "Fast value sprint", description: "Deliver a narrow value slice quickly.", approach: "Sprint then review.", risk: "Medium", expected_outcome: "Fast evidence." }
            ]
          })
        };
      }
      if (prompt.includes("Generate simulation scenarios")) {
        return { response: JSON.stringify({ scenarios: [{ name: "best_case", conditions: { risk_delta: -0.1 } }, { name: "worst_case", conditions: { risk_delta: 0.2 } }, { name: "realistic_case", conditions: {} }], confidence: 0.8 }) };
      }
      if (prompt.includes("Generate strategic options")) {
        return { response: JSON.stringify({ options: [{ name: "Simulated option", description: "Execute with controls.", risk: "medium" }], confidence: 0.8 }) };
      }
      if (prompt.includes("Generate adversarial objections")) {
        return { response: JSON.stringify({ objections: [{ id: "obj_1", text: "Capacity pressure", severity: "medium" }], objection: "Capacity pressure", stress_tests: [], verdict: "medium_risk", confidence: 0.8 }) };
      }
      if (prompt.includes("Evaluate the simulated decision outcome")) {
        return { response: JSON.stringify({ scenario: "realistic_case", risk_score: 0.35, success_probability: 0.78, resilience: 0.72, key_failures: [], recommendation: "proceed", confidence: 0.82 }) };
      }
      if (prompt.includes("Evaluate this strategy")) {
        return { response: JSON.stringify({ scores: { feasibility: 82, risk: 74, impact: 81, resilience: 79 }, overall_score: 80, justification: "Best balance of feasibility, risk control, impact, and resilience." }) };
      }
      return { response: "{}" };
    }
  };
}

test("LLM router selects task-specific models and calls a real LLM binding", async () => {
  const ai = outcomeAI();
  assert.equal(selectedLLMModel("planning", { OPENAI_API_KEY: "x" }), "gpt-4o");
  assert.equal(selectedLLMModel("evaluation", { OPENAI_API_KEY: "x" }), "gpt-4o-mini");
  const raw = await callLLM({ task: "planning", prompt: "Generate 3-5 distinct strategic options", env: { AI: ai } });
  assert.match(raw, /strategies/);
  assert.equal(ai.calls.length, 1);
});

test("outcome engine generates, simulates, evaluates, scores, and ranks strategies", async () => {
  const env = { AI: outcomeAI(), DB: new MockD1() };
  const outcome = await runOutcomeEngine({
    case_id: "OUTCOME-1",
    organization_id: "org-test",
    user_goal: "Migrate cloud analytics workload while protecting POPIA and uptime risk",
    verification_chain: { devil_advocate_validated: true }
  }, env);

  assert.ok(outcome.strategies_tested >= 3);
  assert.equal(outcome.ranked_strategies.length, outcome.strategies_tested);
  assert.ok(outcome.recommended_strategy.name);
  assert.ok(outcome.validation_summary);
  for (const item of outcome.ranked_strategies) {
    assert.equal(typeof item.simulation.success_probability, "number");
    assert.equal(typeof item.simulation.risk_score, "number");
    assert.equal(typeof item.simulation.cost_score, "number");
    assert.equal(typeof item.simulation.resilience_score, "number");
    assert.equal(typeof item.evaluation.overall_score, "number");
    assert.equal(typeof item.score, "number");
  }
});

test("learning loop stores private outcome feedback and publishes anonymized global intelligence", async () => {
  const db = new MockD1();
  const user = testUser();
  const caseState = {
    case_id: "OUTCOME-LEARN-1",
    organization_id: user.organization_id,
    user_goal: "Migrate cloud analytics workload while protecting POPIA and uptime risk",
    outcome: {
      recommended_strategy: { name: "Governed pilot", description: "Pilot the change in a controlled unit." },
      confidence: 80,
      validation_summary: "Expected controlled rollout to reduce risk."
    }
  };

  const learning = await recordOutcomeFeedback({
    caseState,
    actualOutcome: { actual_score: 45, outcome: "failure", notes: "Controls were late." },
    env: { DB: db },
    user
  });

  assert.equal(learning.expectation_met, false);
  assert.equal(db.outcomeFeedback.length, 1);
  assert.equal(db.outcomeFeedback[0].organization_id, user.organization_id);
  assert.equal(db.globalIntelligence.length, 1);
  assert.equal(db.globalIntelligence[0].organization_id, undefined);
  assert.equal(db.globalIntelligence[0].case_id, undefined);
  assert.match(db.globalIntelligence[0].lesson, /missed expected outcome|underperformed|Strengthen/i);
});

test("outcome engine uses private learning and global intelligence in returned context", async () => {
  const db = new MockD1();
  db.outcomeFeedback.push({
    id: "fb-1",
    case_id: "PRIVATE-OLD",
    organization_id: "org-test",
    case_type: "cloud_migration",
    strategy_name: "Governed pilot",
    expected_score: 82,
    actual_score: 42,
    outcome: "failure",
    score_delta: -40,
    lesson: "Prior governed pilot failed because resilience gates were too late.",
    created_at: "2026-04-20T10:00:00.000Z"
  });
  db.globalIntelligence.push({
    id: "global-1",
    insight_type: "failure_pattern",
    case_type: "cloud_migration",
    strategy_pattern: "phased_governed_rollout",
    lesson: "Across organizations, late resilience gates repeatedly reduced cloud migration outcomes.",
    impact_score: 0.9,
    confidence: 0.84,
    sample_size: 4,
    tags: "[]",
    updated_at: "2026-04-22T10:00:00.000Z"
  });

  const outcome = await runOutcomeEngine({
    case_id: "OUTCOME-2",
    organization_id: "org-test",
    user_goal: "Migrate cloud analytics workload while protecting POPIA and uptime risk",
    verification_chain: { devil_advocate_validated: true }
  }, { AI: outcomeAI(), DB: db });

  assert.match(outcome.system_learning_insight, /Prior governed pilot failed/);
  assert.match(outcome.global_intelligence_insight, /Across organizations/);
  assert.ok(Array.isArray(outcome.global_intelligence_used));
  assert.ok(Number.isFinite(outcome.learning_adjustment));
});
