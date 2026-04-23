import { GlobalIntelligenceStore, anonymizeOutcomeInsight } from "../intelligence/global-intelligence-store.js";
import { D1MemoryStore, deriveCaseType } from "../memory/d1-memory-store.js";

function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function strategyName(strategy = {}) {
  if (typeof strategy === "string") return strategy;
  return strategy.name || strategy.description || "Validated strategy";
}

function normalizeActualOutcome(actualOutcome = {}) {
  const actualScore = clamp(actualOutcome.actual_score ?? actualOutcome.score ?? (actualOutcome.outcome === "success" ? 85 : 35));
  const expectedScore = clamp(actualOutcome.expected_score ?? actualOutcome.expected_confidence ?? 0);
  return {
    outcome: actualOutcome.outcome === "failure" || actualScore < Math.max(50, expectedScore * 0.75) ? "failure" : "success",
    actual_score: actualScore,
    expected_score: expectedScore,
    confidence: clamp(actualOutcome.confidence ?? 75) / 100,
    notes: String(actualOutcome.notes || actualOutcome.summary || "").slice(0, 600),
    measured_at: actualOutcome.measured_at || new Date().toISOString()
  };
}

export function evaluateExpectedVsActual(caseState = {}, actualOutcome = {}) {
  const expected = {
    recommended_strategy: caseState.outcome?.recommended_strategy || caseState.decision?.recommended_strategy || caseState.recommended_strategy || null,
    confidence: clamp(caseState.outcome?.confidence ?? caseState.decision?.confidence ?? 0),
    validation_summary: caseState.outcome?.validation_summary || caseState.decision?.rationale || ""
  };
  const actual = normalizeActualOutcome({
    ...actualOutcome,
    expected_score: actualOutcome.expected_score ?? expected.confidence
  });
  const score_delta = Number((actual.actual_score - expected.confidence).toFixed(2));
  const expectation_met = actual.outcome === "success" && score_delta >= -15;
  return {
    expected,
    actual,
    score_delta,
    expectation_met,
    lesson: expectation_met
      ? `${strategyName(expected.recommended_strategy)} met or exceeded expected outcome. Reinforce this pattern.`
      : `${strategyName(expected.recommended_strategy)} missed expected outcome by ${Math.abs(score_delta)} points. Strengthen evidence, resilience, and risk controls.`
  };
}

export async function recordOutcomeFeedback({ caseState = {}, actualOutcome = {}, env = {}, user = null }) {
  if (!env.DB?.prepare) throw new Error("D1 DB binding is required to record outcome feedback.");
  const now = new Date().toISOString();
  const organizationId = user?.organization_id || caseState.organization_id;
  if (!organizationId) throw new Error("organization_id is required for private learning.");
  const record = evaluateExpectedVsActual(caseState, actualOutcome);
  const caseType = deriveCaseType(caseState.user_goal || "");
  const id = actualOutcome.id || crypto.randomUUID();

  await env.DB
    .prepare(
      `INSERT INTO outcome_feedback
        (id, case_id, organization_id, case_type, strategy_name, expected_score, actual_score, outcome, score_delta, lesson, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      caseState.case_id,
      organizationId,
      caseType,
      strategyName(record.expected.recommended_strategy),
      record.expected.confidence,
      record.actual.actual_score,
      record.actual.outcome,
      record.score_delta,
      record.lesson,
      now
    )
    .run();

  const memoryStore = new D1MemoryStore(env.DB);
  await memoryStore.remember({
    caseState,
    user,
    outcome: record.actual.outcome,
    memory: {
      episodic: [{
        case_id: caseState.case_id,
        case_type: caseType,
        event_type: "real_world_outcome",
        input: { strategy_name: strategyName(record.expected.recommended_strategy), expected_score: record.expected.confidence },
        output: { actual_score: record.actual.actual_score, score_delta: record.score_delta },
        outcome: record.actual.outcome,
        confidence: record.actual.confidence
      }],
      semantic: [{
        entity: "outcome_lesson",
        fact: record.lesson,
        source_case_id: caseState.case_id,
        confidence: record.actual.confidence
      }],
      procedural: [{
        task_type: caseType,
        strategy_steps: [strategyName(record.expected.recommended_strategy), record.lesson],
        success_rate: record.actual.outcome === "success" ? 0.82 : 0.34,
        confidence: record.actual.confidence
      }],
      confidence: record.actual.confidence
    },
    reflection: {
      what_worked: record.expectation_met ? [record.lesson] : [],
      what_failed: record.expectation_met ? [] : [record.lesson],
      improvements: [record.lesson]
    },
    learning: {
      lessons: [record.lesson],
      improvements: [record.lesson],
      strategy_updates: [{ strategy: strategyName(record.expected.recommended_strategy), outcome: record.actual.outcome }]
    }
  });

  const globalStore = new GlobalIntelligenceStore(env.DB);
  const anonymized = anonymizeOutcomeInsight({ caseState, outcomeRecord: record, learning: { lesson: record.lesson } });
  const global = await globalStore.publishAnonymizedInsight(anonymized);

  return {
    id,
    case_id: caseState.case_id,
    organization_id: organizationId,
    expectation_met: record.expectation_met,
    score_delta: record.score_delta,
    lesson: record.lesson,
    system_learning_insight: record.lesson,
    global_intelligence_published: Boolean(global?.id),
    recorded_at: now
  };
}

export async function learningSignalsForCase({ caseState = {}, env = {}, limit = 3 }) {
  if (!env.DB?.prepare || !caseState.organization_id) return { private_lessons: [], adjustment: 0 };
  const caseType = deriveCaseType(caseState.user_goal || "");
  const result = await env.DB
    .prepare(
      `SELECT strategy_name, outcome, score_delta, lesson, created_at
       FROM outcome_feedback
       WHERE organization_id = ? AND case_type = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .bind(caseState.organization_id, caseType, Math.max(Number(limit || 3), 1))
    .all();
  const rows = result.results || [];
  const adjustment = rows.reduce((total, row) => total + Math.max(-8, Math.min(8, Number(row.score_delta || 0) / 10)), 0);
  return {
    private_lessons: rows.map((row) => ({
      strategy_name: row.strategy_name,
      outcome: row.outcome,
      lesson: row.lesson,
      score_delta: Number(row.score_delta || 0)
    })),
    adjustment: Number(adjustment.toFixed(2))
  };
}
