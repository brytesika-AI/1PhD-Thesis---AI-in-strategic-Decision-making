function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function deriveCaseType(text = "") {
  const lower = String(text).toLowerCase();
  if (lower.includes("cloud") || lower.includes("migration")) return "cloud_migration";
  if (lower.includes("compliance") || lower.includes("popia") || lower.includes("regulatory")) return "regulatory_compliance";
  if (lower.includes("load") || lower.includes("infrastructure") || lower.includes("uptime")) return "infrastructure_resilience";
  if (lower.includes("vendor") || lower.includes("sla")) return "vendor_risk";
  return "strategic_decision";
}

function orgId(user, caseState = {}) {
  return user?.organization_id || caseState.organization_id || null;
}

function userId(user, caseState = {}) {
  return user?.user_id || caseState.last_modified_by || caseState.created_by || null;
}

function rowToEpisodic(row) {
  return {
    ...row,
    input: parseJson(row.input, {}),
    output: parseJson(row.output, {}),
    confidence: Number(row.confidence || 0)
  };
}

function rowToProcedural(row) {
  return {
    ...row,
    strategy_steps: parseJson(row.strategy_steps, []),
    success_rate: Number(row.success_rate || 0),
    failure_count: Number(row.failure_count || 0)
  };
}

export class D1MemoryStore {
  constructor(db) {
    this.db = db;
  }

  async retrieve({ caseId, userGoal = "", user = null, caseState = {}, limit = 5 }) {
    const organizationId = orgId(user, caseState);
    const caseType = deriveCaseType(userGoal || caseState.user_goal || "");
    const scopedOrg = organizationId || "__global__";

    const episodic = await this.db
      .prepare(
        `SELECT id, case_id, timestamp, event_type, input, output, outcome, confidence, case_type
         FROM episodic_memory
         WHERE COALESCE(organization_id, '__global__') = ? AND case_id != ?
         ORDER BY
          CASE WHEN case_type = ? THEN 0 ELSE 1 END,
          timestamp DESC
         LIMIT ?`
      )
      .bind(scopedOrg, caseId, caseType, limit)
      .all();

    const semantic = await this.db
      .prepare(
        `SELECT id, entity, fact, source_case_id, confidence, created_at
         FROM semantic_memory
         WHERE COALESCE(organization_id, '__global__') = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .bind(scopedOrg, limit)
      .all();

    const procedural = await this.db
      .prepare(
        `SELECT id, task_type, strategy_steps, success_rate, failure_count, last_used
         FROM procedural_memory
         WHERE COALESCE(organization_id, '__global__') = ?
         ORDER BY success_rate DESC, failure_count ASC, last_used DESC
         LIMIT ?`
      )
      .bind(scopedOrg, limit)
      .all();

    return {
      episodic: (episodic.results || []).map(rowToEpisodic),
      semantic: (semantic.results || []).map((row) => ({ ...row, confidence: Number(row.confidence || 0) })),
      procedural: (procedural.results || []).map(rowToProcedural),
      retrieval: {
        case_type: caseType,
        strategy: "exact_case_type_then_recency_and_success_rate",
        vector_similarity: "not_configured"
      }
    };
  }

  async remember({ caseState, memory, reflection = {}, user = null, outcome = "success" }) {
    const now = new Date().toISOString();
    const organizationId = orgId(user, caseState);
    const actorId = userId(user, caseState);
    const caseType = deriveCaseType(caseState.user_goal || "");

    for (const item of memory.episodic || []) {
      await this.db
        .prepare(
          `INSERT INTO episodic_memory
            (id, case_id, user_id, organization_id, case_type, timestamp, event_type, input, output, outcome, confidence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          item.id || crypto.randomUUID(),
          item.case_id || caseState.case_id,
          actorId,
          organizationId,
          item.case_type || caseType,
          item.timestamp || now,
          item.event_type || "decision_loop",
          JSON.stringify(item.input || { user_goal: caseState.user_goal }),
          JSON.stringify(item.output || { stop_reason: caseState.loop?.stop_reason, status: caseState.status }),
          item.outcome || outcome,
          Number(item.confidence ?? 0.7)
        )
        .run();
    }

    for (const item of memory.semantic || []) {
      await this.db
        .prepare(
          `INSERT INTO semantic_memory
            (id, user_id, organization_id, entity, fact, source_case_id, confidence, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          item.id || crypto.randomUUID(),
          actorId,
          organizationId,
          item.entity || caseType,
          item.fact || "",
          item.source_case_id || caseState.case_id,
          Number(item.confidence ?? 0.7),
          item.created_at || now
        )
        .run();
    }

    const proceduralItems = [
      ...(memory.procedural || []),
      ...((reflection.improvements || []).length
        ? [{ task_type: caseType, strategy_steps: reflection.improvements, success_rate: outcome === "success" ? 0.72 : 0.42 }]
        : [])
    ];

    for (const item of proceduralItems) {
      await this.upsertProcedure({
        item,
        caseState,
        user,
        outcome,
        now
      });
    }
  }

  async upsertProcedure({ item, caseState, user = null, outcome = "success", now = new Date().toISOString() }) {
    const organizationId = orgId(user, caseState);
    const actorId = userId(user, caseState);
    const taskType = item.task_type || deriveCaseType(caseState.user_goal || "");
    const strategySteps = Array.isArray(item.strategy_steps) ? item.strategy_steps : [String(item.strategy_steps || "Review governance gates.")];
    const baseSuccessRate = Number(item.success_rate ?? (outcome === "success" ? 0.7 : 0.45));
    const failureDelta = outcome === "success" ? 0 : 1;
    const successAdjustment = outcome === "success" ? 0.08 : -0.12;

    await this.db
      .prepare(
        `INSERT INTO procedural_memory
          (id, user_id, organization_id, task_type, strategy_steps, success_rate, failure_count, last_used)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(organization_id, task_type) DO UPDATE SET
          user_id = excluded.user_id,
          strategy_steps = excluded.strategy_steps,
          success_rate = MIN(0.99, MAX(0.01, ((procedural_memory.success_rate + excluded.success_rate) / 2.0) + ?)),
          failure_count = procedural_memory.failure_count + ?,
          last_used = excluded.last_used`
      )
      .bind(
        item.id || crypto.randomUUID(),
        actorId,
        organizationId,
        taskType,
        JSON.stringify(strategySteps),
        baseSuccessRate,
        failureDelta,
        now,
        successAdjustment,
        failureDelta
      )
      .run();
  }
}
