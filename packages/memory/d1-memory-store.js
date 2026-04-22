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
  if (source.size === 0) return 0;
  const target = tokenize(haystack);
  let matches = 0;
  for (const token of source) {
    if (target.has(token)) matches += 1;
  }
  return matches / source.size;
}

function recencyScore(timestamp) {
  const time = Date.parse(timestamp || "");
  if (!Number.isFinite(time)) return 0;
  const ageDays = Math.max(0, (Date.now() - time) / 86400000);
  return 1 / (1 + ageDays);
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

function rowToOrganizationMemory(row) {
  return {
    ...row,
    content: parseJson(row.content, {}),
    tags: parseJson(row.tags, []),
    confidence: Number(row.confidence || 0),
    success_rate: Number(row.success_rate || 0),
    failure_count: Number(row.failure_count || 0)
  };
}

function rankRows(rows = [], query = "") {
  return [...rows]
    .map((row) => {
      const content = typeof row.content === "string" ? row.content : JSON.stringify(row.content || row);
      const similarity = similarityScore(query, `${content} ${(row.tags || []).join(" ")} ${row.case_type || row.task_type || row.entity || ""}`);
      const successRate = Number(row.success_rate ?? (row.outcome === "success" ? 0.7 : 0.3));
      const recency = recencyScore(row.updated_at || row.timestamp || row.created_at || row.last_used);
      return {
        ...row,
        relevance: Number((similarity * 0.5 + successRate * 0.3 + recency * 0.2).toFixed(4)),
        ranking: { similarity, success_rate: successRate, recency }
      };
    })
    .sort((left, right) => Number(right.relevance || 0) - Number(left.relevance || 0));
}

function normalizeLearningArray(value) {
  return asArray(value)
    .map((item) => (typeof item === "string" ? item : item?.lesson || item?.description || JSON.stringify(item)))
    .filter(Boolean);
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export class D1MemoryStore {
  constructor(db) {
    this.db = db;
  }

  scopedOrganization(user, caseState = {}) {
    return orgId(user, caseState);
  }

  async retrieve({ caseId, userGoal = "", user = null, caseState = {}, limit = 5 }) {
    const organizationId = orgId(user, caseState);
    const caseType = deriveCaseType(userGoal || caseState.user_goal || "");
    if (!organizationId) {
      return {
        episodic: [],
        semantic: [],
        procedural: [],
        retrieval: {
          case_type: caseType,
          strategy: "organization_scope_required",
          governance: "No shared memory returned without organization_id."
        },
        organizational_intelligence: buildOrganizationalIntelligence({ episodic: [], semantic: [], procedural: [] })
      };
    }

    const shared = await this.getSharedMemory({ caseId, userGoal, user, caseState, limit });

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
      .bind(organizationId, caseId, caseType, limit)
      .all();

    const semantic = await this.db
      .prepare(
        `SELECT id, entity, fact, source_case_id, confidence, created_at
         FROM semantic_memory
         WHERE COALESCE(organization_id, '__global__') = ?
         ORDER BY created_at DESC
       LIMIT ?`
      )
      .bind(organizationId, limit)
      .all();

    const procedural = await this.db
      .prepare(
        `SELECT id, task_type, strategy_steps, success_rate, failure_count, last_used
         FROM procedural_memory
         WHERE COALESCE(organization_id, '__global__') = ?
         ORDER BY success_rate DESC, failure_count ASC, last_used DESC
       LIMIT ?`
      )
      .bind(organizationId, limit)
      .all();

    const legacy = {
      episodic: (episodic.results || []).map(rowToEpisodic),
      semantic: (semantic.results || []).map((row) => ({ ...row, confidence: Number(row.confidence || 0) })),
      procedural: (procedural.results || []).map(rowToProcedural)
    };
    const merged = {
      episodic: rankRows([...shared.episodic, ...legacy.episodic], userGoal).slice(0, limit),
      semantic: rankRows([...shared.semantic, ...legacy.semantic], userGoal).slice(0, limit),
      procedural: rankRows([...shared.procedural, ...legacy.procedural], userGoal).slice(0, limit)
    };

    return {
      ...merged,
      retrieval: {
        case_type: caseType,
        strategy: "organization_scoped_similarity_success_rate_recency",
        ranking: ["similarity", "success_rate", "recency"],
        governance: "organization_id scoped; no cross-organization reads"
      },
      organizational_intelligence: buildOrganizationalIntelligence(merged)
    };
  }

  async getSharedMemory({ caseId, userGoal = "", user = null, caseState = {}, limit = 5 }) {
    return {
      episodic: await this.fetchSimilarCases({ caseId, userGoal, user, caseState, limit }),
      semantic: await this.fetchRelevantFacts({ userGoal, user, caseState, limit }),
      procedural: await this.fetchBestStrategies({ userGoal, user, caseState, limit })
    };
  }

  async fetchSimilarCases({ caseId, userGoal = "", user = null, caseState = {}, limit = 5 }) {
    return this.fetchOrganizationMemory({
      memoryType: "episodic",
      userGoal,
      user,
      caseState,
      limit,
      excludeCaseId: caseId
    });
  }

  async fetchRelevantFacts({ userGoal = "", user = null, caseState = {}, limit = 5 }) {
    return this.fetchOrganizationMemory({ memoryType: "semantic", userGoal, user, caseState, limit });
  }

  async fetchBestStrategies({ userGoal = "", user = null, caseState = {}, limit = 5 }) {
    return this.fetchOrganizationMemory({ memoryType: "procedural", userGoal, user, caseState, limit });
  }

  async fetchOrganizationMemory({ memoryType, userGoal = "", user = null, caseState = {}, limit = 5, excludeCaseId = null }) {
    const organizationId = orgId(user, caseState);
    if (!organizationId) return [];
    const result = await this.db
      .prepare(
        `SELECT id, organization_id, memory_type, content, tags, confidence, success_rate, failure_count, created_at, updated_at
         FROM organization_memory
         WHERE organization_id = ? AND memory_type = ?
         ORDER BY success_rate DESC, updated_at DESC
         LIMIT ?`
      )
      .bind(organizationId, memoryType, Math.max(Number(limit || 5) * 5, 10))
      .all();
    const rows = (result.results || [])
      .map(rowToOrganizationMemory)
      .filter((row) => !excludeCaseId || row.content?.case_id !== excludeCaseId);
    return rankRows(rows, userGoal).slice(0, limit);
  }

  async remember({ caseState, memory, reflection = {}, learning = {}, user = null, outcome = "success" }) {
    const now = new Date().toISOString();
    const organizationId = orgId(user, caseState);
    const actorId = userId(user, caseState);
    const caseType = deriveCaseType(caseState.user_goal || "");
    if (!organizationId) return null;

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
      await this.writeOrganizationMemory({
        organizationId,
        memoryType: "episodic",
        content: {
          case_id: item.case_id || caseState.case_id,
          case_type: item.case_type || caseType,
          event_type: item.event_type || "decision_loop",
          input: item.input || { user_goal: caseState.user_goal },
          output: item.output || { stop_reason: caseState.loop?.stop_reason, status: caseState.status },
          outcome: item.outcome || outcome
        },
        tags: [caseType, item.outcome || outcome, "similar_case"],
        confidence: Number(item.confidence ?? 0.7),
        successRate: item.outcome === "failure" || outcome === "failure" ? 0.25 : 0.75,
        failureCount: item.outcome === "failure" || outcome === "failure" ? 1 : 0,
        now
      });
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
      await this.writeOrganizationMemory({
        organizationId,
        memoryType: "semantic",
        content: {
          entity: item.entity || caseType,
          fact: item.fact || "",
          source_case_id: item.source_case_id || caseState.case_id
        },
        tags: [caseType, item.entity || "strategic_decision", "fact"],
        confidence: Number(item.confidence ?? 0.7),
        successRate: outcome === "success" ? 0.65 : 0.35,
        failureCount: outcome === "failure" ? 1 : 0,
        now
      });
    }

    const proceduralItems = [
      ...(memory.procedural || []),
      ...((reflection.improvements || []).length
        ? [{ task_type: caseType, strategy_steps: reflection.improvements, success_rate: outcome === "success" ? 0.72 : 0.42 }]
        : [])
    ];

    for (const item of proceduralItems) {
      const procedure = await this.upsertProcedure({
        item,
        caseState,
        user,
        outcome,
        now
      });
      await this.writeOrganizationMemory({
        organizationId,
        memoryType: "procedural",
        content: {
          case_id: caseState.case_id,
          task_type: procedure.task_type,
          framework: procedure.framework || item.framework || null,
          use_cases: procedure.use_cases || item.use_cases || [],
          strategy_steps: procedure.strategy_steps,
          outcome,
          agent_learning: learning.strategy_updates || []
        },
        tags: [caseType, "strategy", outcome],
        confidence: Number(item.confidence ?? memory.confidence ?? 0.72),
        successRate: procedure.success_rate,
        failureCount: procedure.failure_count,
        now
      });
    }

    await this.writeAgentLearningLog({ caseState, learning, reflection, organizationId, now });
    return { organization_id: organizationId, recorded_at: now };
  }

  async writeOrganizationMemory({ organizationId, memoryType, content, tags = [], confidence = 0.7, successRate = 0.5, failureCount = 0, now = new Date().toISOString() }) {
    await this.db
      .prepare(
        `INSERT INTO organization_memory
          (id, organization_id, memory_type, content, tags, confidence, success_rate, failure_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        organizationId,
        memoryType,
        JSON.stringify(content || {}),
        JSON.stringify(tags || []),
        Number(confidence ?? 0.7),
        Math.min(0.99, Math.max(0.01, Number(successRate ?? 0.5))),
        Number(failureCount || 0),
        now,
        now
      )
      .run();
  }

  async writeAgentLearningLog({ caseState, learning = {}, reflection = {}, organizationId, now = new Date().toISOString() }) {
    const agentLessons = agentSpecificLessons(caseState, learning, reflection);
    for (const item of agentLessons) {
      await this.db
        .prepare(
          `INSERT INTO agent_learning_log
            (id, agent_name, lesson, improvement, impact, organization_id, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          item.agent_name,
          item.lesson,
          item.improvement || "",
          item.impact || "",
          organizationId,
          now
        )
        .run();
    }
  }

  async upsertProcedure({ item, caseState, user = null, outcome = "success", now = new Date().toISOString() }) {
    const organizationId = orgId(user, caseState);
    const actorId = userId(user, caseState);
    const taskType = item.task_type || deriveCaseType(caseState.user_goal || "");
    const strategySteps = Array.isArray(item.strategy_steps) ? item.strategy_steps : [String(item.strategy_steps || "Review governance gates.")];
    const baseSuccessRate = Number(item.success_rate ?? (outcome === "success" ? 0.7 : 0.45));
    const failureDelta = outcome === "success" ? 0 : 1;
    const successAdjustment = outcome === "success" ? 0.1 : -0.1;

    await this.db
      .prepare(
        `INSERT INTO procedural_memory
          (id, user_id, organization_id, task_type, strategy_steps, success_rate, failure_count, last_used)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(organization_id, task_type) DO UPDATE SET
          user_id = excluded.user_id,
          strategy_steps = excluded.strategy_steps,
          success_rate = MIN(0.99, MAX(0.01, procedural_memory.success_rate + ?)),
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
    return {
      task_type: taskType,
      framework: item.framework || (String(taskType).startsWith("framework_") ? String(taskType).replace(/^framework_/, "") : null),
      use_cases: item.use_cases || [deriveCaseType(caseState.user_goal || "")],
      strategy_steps: strategySteps,
      success_rate: Math.min(0.99, Math.max(0.01, baseSuccessRate + successAdjustment)),
      failure_count: failureDelta
    };
  }
}

function agentSpecificLessons(caseState = {}, learning = {}, reflection = {}) {
  const lessons = normalizeLearningArray(learning.lessons || reflection.what_worked);
  const improvements = normalizeLearningArray(learning.improvements || reflection.improvements);
  const strategyUpdates = normalizeLearningArray(learning.strategy_updates);
  const failedPatterns = [
    ...(caseState.devil_advocate_findings?.objections || []),
    ...(caseState.objections || [])
  ].map((item) => item.text || item.claim || item.risk).filter(Boolean);
  const causes = asArray(caseState.evidence_bundle?.causes || caseState.stage_outputs?.auditor?.evidence?.causes)
    .map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
  const strategies = asArray(caseState.options || caseState.options_generated)
    .map((item) => item.name || item.description || JSON.stringify(item));

  return [
    {
      agent_name: "Devil's Advocate",
      lesson: failedPatterns[0] || lessons[0] || "No recurring failure pattern detected.",
      improvement: improvements.find((item) => item.toLowerCase().includes("evidence")) || improvements[0] || "Keep adversarial validation before final policy clearance.",
      impact: failedPatterns.length ? `${failedPatterns.length} failed patterns available for future avoidance.` : "Future challenges remain auditable."
    },
    {
      agent_name: "Forensic Analyst",
      lesson: causes[0] || lessons[1] || "Root-cause signal retained for similar cases.",
      improvement: improvements.find((item) => item.toLowerCase().includes("gate")) || improvements[1] || "Strengthen forensic evidence gates before option selection.",
      impact: causes.length ? `${causes.length} root-cause patterns indexed.` : "Forensic memory updated."
    },
    {
      agent_name: "Creative Catalyst",
      lesson: strategies[0] || strategyUpdates[0] || "Successful option design patterns retained.",
      improvement: strategyUpdates[0] || improvements[2] || "Prefer strategies with stronger historical success rates.",
      impact: strategies.length ? `${strategies.length} strategy patterns evaluated.` : "Strategy memory updated."
    }
  ];
}

export function buildOrganizationalIntelligence(memory = {}) {
  const successfulCases = asArray(memory.episodic).filter((item) => item.content?.outcome === "success" || item.outcome === "success");
  const failedPatterns = asArray(memory.episodic).filter((item) => item.content?.outcome === "failure" || item.outcome === "failure");
  const bestStrategy = asArray(memory.procedural)
    .sort((left, right) => Number(right.success_rate || 0) - Number(left.success_rate || 0))[0];
  const confidenceValues = [
    ...asArray(memory.episodic),
    ...asArray(memory.semantic),
    ...asArray(memory.procedural)
  ].map((item) => Number(item.confidence || 0)).filter((value) => value > 0);
  const confidence = confidenceValues.length
    ? confidenceValues.reduce((total, value) => total + value, 0) / confidenceValues.length
    : 0.5;
  return {
    recommended_strategy: bestStrategy?.content?.task_type || bestStrategy?.task_type || "Use governed evidence, challenge, and monitoring gates.",
    confidence: Number(Math.min(0.95, Math.max(0.5, confidence)).toFixed(2)),
    based_on: [
      `${successfulCases.length} similar successful cases`,
      `${failedPatterns.length} failed patterns avoided`,
      `${asArray(memory.procedural).length} learned strategies ranked by success rate`
    ]
  };
}

export async function getSharedMemory(state = {}, env = {}) {
  const store = new D1MemoryStore(env.DB);
  return store.getSharedMemory({
    caseId: state.case_id,
    userGoal: state.user_goal || state.text || "",
    user: state.user || null,
    caseState: state
  });
}
