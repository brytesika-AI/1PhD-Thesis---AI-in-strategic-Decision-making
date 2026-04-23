import { deriveCaseType } from "../memory/d1-memory-store.js";

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function tokenize(value = "") {
  return new Set(
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9_ -]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2)
  );
}

function similarityScore(needle = "", haystack = "") {
  const source = tokenize(needle);
  if (!source.size) return 0;
  const target = tokenize(haystack);
  let matches = 0;
  for (const token of source) {
    if (target.has(token)) matches += 1;
  }
  return matches / source.size;
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

function strategyPattern(strategy = {}) {
  const text = `${strategy.name || ""} ${strategy.description || ""} ${strategy.approach || ""}`.toLowerCase();
  if (text.includes("pilot") || text.includes("phased") || text.includes("stage")) return "phased_governed_rollout";
  if (text.includes("resilience") || text.includes("continuity") || text.includes("harden")) return "resilience_first";
  if (text.includes("sprint") || text.includes("focused") || text.includes("quick")) return "focused_value_sprint";
  if (text.includes("vendor") || text.includes("sla")) return "vendor_risk_control";
  return "governed_strategy";
}

function sanitizeInsightText(value = "", fallback = "Validated strategy pattern improved outcomes.") {
  const text = String(value || fallback)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[redacted-number]")
    .replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g, "the organization")
    .slice(0, 420);
  return text || fallback;
}

export function anonymizeOutcomeInsight({ caseState = {}, outcomeRecord = {}, learning = {} }) {
  const caseType = deriveCaseType(caseState.user_goal || outcomeRecord.goal || "");
  const actual = outcomeRecord.actual || {};
  const expected = outcomeRecord.expected || {};
  const strategy = expected.recommended_strategy || caseState.outcome?.recommended_strategy || caseState.proposed_strategy || {};
  const success = actual.outcome === "success" || Number(actual.actual_score || 0) >= Number(expected.confidence || 0) * 0.8;
  const delta = Number(actual.actual_score || 0) - Number(expected.confidence || 0);
  const lesson = sanitizeInsightText(
    learning.lesson || learning.lesson_learned || outcomeRecord.lesson || (
      success
        ? `${strategyPattern(strategy)} improved outcome reliability for ${caseType}.`
        : `${strategyPattern(strategy)} underperformed; strengthen evidence and resilience gates for ${caseType}.`
    )
  );
  const impactScore = clamp(Math.abs(delta) / 100 + (success ? 0.65 : 0.55), 0.1, 0.99);
  return {
    insight_type: success ? "success_pattern" : "failure_pattern",
    case_type: caseType,
    strategy_pattern: strategyPattern(strategy),
    lesson,
    impact_score: Number(impactScore.toFixed(2)),
    confidence: Number(clamp(actual.confidence ?? 0.74, 0.1, 0.99).toFixed(2)),
    sample_size: 1,
    source_hash: shortHash(`${caseType}:${strategyPattern(strategy)}:${lesson}`)
  };
}

function rowToInsight(row = {}) {
  const tags = parseJson(row.tags, []);
  return {
    id: row.id,
    insight_type: row.insight_type,
    case_type: row.case_type,
    strategy_pattern: row.strategy_pattern,
    lesson: row.lesson,
    impact_score: Number(row.impact_score || 0),
    confidence: Number(row.confidence || 0),
    sample_size: Number(row.sample_size || 1),
    tags,
    updated_at: row.updated_at
  };
}

export class GlobalIntelligenceStore {
  constructor(db) {
    this.db = db;
  }

  async publishAnonymizedInsight(insight = {}) {
    if (!this.db?.prepare || !insight.lesson) return null;
    const now = new Date().toISOString();
    const id = insight.source_hash || crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO global_intelligence
          (id, insight_type, case_type, strategy_pattern, lesson, impact_score, confidence, sample_size, source_hash, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          impact_score = MIN(0.99, MAX(global_intelligence.impact_score, excluded.impact_score)),
          confidence = MIN(0.99, (global_intelligence.confidence + excluded.confidence) / 2),
          sample_size = global_intelligence.sample_size + 1,
          updated_at = excluded.updated_at`
      )
      .bind(
        id,
        insight.insight_type || "outcome_pattern",
        insight.case_type || "strategic_decision",
        insight.strategy_pattern || "governed_strategy",
        sanitizeInsightText(insight.lesson),
        clamp(insight.impact_score ?? 0.6),
        clamp(insight.confidence ?? 0.7),
        Number(insight.sample_size || 1),
        insight.source_hash || id,
        JSON.stringify(asArray(insight.tags).concat([insight.case_type, insight.strategy_pattern]).filter(Boolean)),
        now,
        now
      )
      .run();
    return { id, published_at: now };
  }

  async retrieveHighImpactInsights({ goal = "", caseType = null, limit = 3 } = {}) {
    if (!this.db?.prepare) return [];
    const targetCaseType = caseType || deriveCaseType(goal);
    const result = await this.db
      .prepare(
        `SELECT id, insight_type, case_type, strategy_pattern, lesson, impact_score, confidence, sample_size, tags, updated_at
         FROM global_intelligence
         WHERE case_type = ? OR case_type = 'strategic_decision'
         ORDER BY impact_score DESC, confidence DESC, sample_size DESC, updated_at DESC
         LIMIT ?`
      )
      .bind(targetCaseType, Math.max(Number(limit || 3) * 4, 8))
      .all();
    return (result.results || [])
      .map(rowToInsight)
      .map((item) => ({
        ...item,
        relevance: Number((similarityScore(goal, `${item.case_type} ${item.strategy_pattern} ${item.lesson}`) * 0.45 + item.impact_score * 0.4 + item.confidence * 0.15).toFixed(4))
      }))
      .sort((left, right) => Number(right.relevance || 0) - Number(left.relevance || 0))
      .slice(0, limit);
  }
}
