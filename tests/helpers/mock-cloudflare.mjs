export class MockD1 {
  constructor() {
    this.cases = new Map();
    this.auditEvents = [];
    this.episodicMemory = [];
    this.semanticMemory = [];
    this.proceduralMemory = new Map();
    this.organizationMemory = [];
    this.agentLearningLog = [];
    this.outcomeFeedback = [];
    this.globalIntelligence = [];
    this.digitalTwinStates = [];
    this.users = new Map();
  }

  prepare(sql) {
    return new MockStatement(this, sql);
  }
}

class MockStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async first() {
    if (this.sql.includes("FROM decision_cases")) {
      const payload = this.db.cases.get(this.params[0]);
      return payload ? { payload } : null;
    }
    if (this.sql.includes("FROM digital_twin_state")) {
      const [organizationId] = this.params;
      return this.db.digitalTwinStates
        .filter((row) => row.organization_id === organizationId)
        .sort((left, right) => right.last_updated.localeCompare(left.last_updated))[0] || null;
    }
    return null;
  }

  async all() {
    if (this.sql.includes("FROM decision_cases")) {
      return { results: [...this.db.cases.values()].map((payload) => ({ payload })) };
    }
    if (this.sql.includes("FROM audit_events")) {
      return {
        results: this.db.auditEvents
          .filter((event) => event.case_id === this.params[0])
          .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
      };
    }
    if (this.sql.includes("FROM episodic_memory")) {
      const [organizationId, caseId] = this.params;
      return {
        results: this.db.episodicMemory
          .filter((row) => (row.organization_id || "__global__") === organizationId && row.case_id !== caseId)
          .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      };
    }
    if (this.sql.includes("FROM semantic_memory")) {
      const [organizationId] = this.params;
      return {
        results: this.db.semanticMemory
          .filter((row) => (row.organization_id || "__global__") === organizationId)
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
      };
    }
    if (this.sql.includes("FROM procedural_memory")) {
      const [organizationId] = this.params;
      return {
        results: [...this.db.proceduralMemory.values()]
          .filter((row) => (row.organization_id || "__global__") === organizationId)
          .sort((left, right) => Number(right.success_rate) - Number(left.success_rate) || Number(left.failure_count) - Number(right.failure_count))
      };
    }
    if (this.sql.includes("FROM organization_memory")) {
      const [organizationId, memoryType] = this.params;
      return {
        results: this.db.organizationMemory
          .filter((row) => row.organization_id === organizationId && row.memory_type === memoryType)
          .sort((left, right) => Number(right.success_rate) - Number(left.success_rate) || right.updated_at.localeCompare(left.updated_at))
      };
    }
    if (this.sql.includes("FROM outcome_feedback")) {
      const [organizationId, caseType] = this.params;
      return {
        results: this.db.outcomeFeedback
          .filter((row) => row.organization_id === organizationId && row.case_type === caseType)
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
      };
    }
    if (this.sql.includes("FROM global_intelligence")) {
      const [caseType] = this.params;
      return {
        results: this.db.globalIntelligence
          .filter((row) => row.case_type === caseType || row.case_type === "strategic_decision")
          .sort((left, right) => Number(right.impact_score) - Number(left.impact_score) || Number(right.confidence) - Number(left.confidence))
      };
    }
    if (this.sql.includes("SELECT DISTINCT organization_id FROM users")) {
      return { results: [...this.db.users.values()].map((user) => ({ organization_id: user.organization_id })) };
    }
    return { results: [] };
  }

  async run() {
    if (this.sql.includes("INSERT INTO decision_cases")) {
      const [caseId, status, currentStage, userGoal, payload] = this.params;
      this.db.cases.set(caseId, payload);
      return { success: true, meta: { status, currentStage, userGoal } };
    }
    if (this.sql.includes("INSERT INTO audit_events")) {
      const [
        event_id,
        event_type,
        timestamp,
        case_id,
        agent_id,
        input_summary,
        output_summary,
        tools_used,
        model_used,
        policy_checks,
        human_approval,
        raw_payload
      ] = this.params;
      this.db.auditEvents.push({
        event_id,
        event_type,
        timestamp,
        case_id,
        agent_id,
        input_summary,
        output_summary,
        tools_used,
        model_used,
        policy_checks,
        human_approval,
        raw_payload
      });
      return { success: true };
    }
    if (this.sql.includes("INSERT INTO users")) {
      const [user_id, email, role, organization_id, organization_name] = this.params;
      this.db.users.set(user_id, { user_id, email, role, organization_id, organization_name });
      return { success: true };
    }
    if (this.sql.includes("INSERT INTO episodic_memory")) {
      const [id, case_id, user_id, organization_id, case_type, timestamp, event_type, input, output, outcome, confidence] = this.params;
      this.db.episodicMemory.push({ id, case_id, user_id, organization_id, case_type, timestamp, event_type, input, output, outcome, confidence });
      return { success: true };
    }
    if (this.sql.includes("INSERT INTO semantic_memory")) {
      const [id, user_id, organization_id, entity, fact, source_case_id, confidence, created_at] = this.params;
      this.db.semanticMemory.push({ id, user_id, organization_id, entity, fact, source_case_id, confidence, created_at });
      return { success: true };
    }
    if (this.sql.includes("INSERT INTO procedural_memory")) {
      const [id, user_id, organization_id, task_type, strategy_steps, success_rate, failure_count, last_used, successAdjustment, failureDelta] = this.params;
      const key = `${organization_id || "__global__"}:${task_type}`;
      const existing = this.db.proceduralMemory.get(key);
      if (existing) {
        existing.user_id = user_id;
        existing.strategy_steps = strategy_steps;
        existing.success_rate = Math.min(0.99, Math.max(0.01, Number(existing.success_rate || 0) + Number(successAdjustment || 0)));
        existing.failure_count = Number(existing.failure_count || 0) + Number(failureDelta || 0);
        existing.last_used = last_used;
      } else {
        this.db.proceduralMemory.set(key, { id, user_id, organization_id, task_type, strategy_steps, success_rate, failure_count, last_used });
      }
      return { success: true };
    }
    if (this.sql.includes("INSERT INTO organization_memory")) {
      const [id, organization_id, memory_type, content, tags, confidence, success_rate, failure_count, created_at, updated_at] = this.params;
      this.db.organizationMemory.push({ id, organization_id, memory_type, content, tags, confidence, success_rate, failure_count, created_at, updated_at });
      return { success: true };
    }
    if (this.sql.includes("INSERT INTO agent_learning_log")) {
      const [id, agent_name, lesson, improvement, impact, organization_id, timestamp] = this.params;
      this.db.agentLearningLog.push({ id, agent_name, lesson, improvement, impact, organization_id, timestamp });
      return { success: true };
    }
    if (this.sql.includes("INSERT INTO outcome_feedback")) {
      const [id, case_id, organization_id, case_type, strategy_name, expected_score, actual_score, outcome, score_delta, lesson, created_at] = this.params;
      this.db.outcomeFeedback.push({ id, case_id, organization_id, case_type, strategy_name, expected_score, actual_score, outcome, score_delta, lesson, created_at });
      return { success: true };
    }
    if (this.sql.includes("INSERT INTO global_intelligence")) {
      const [id, insight_type, case_type, strategy_pattern, lesson, impact_score, confidence, sample_size, source_hash, tags, created_at, updated_at] = this.params;
      const existing = this.db.globalIntelligence.find((row) => row.id === id);
      if (existing) {
        existing.impact_score = Math.min(0.99, Math.max(Number(existing.impact_score || 0), Number(impact_score || 0)));
        existing.confidence = Math.min(0.99, (Number(existing.confidence || 0) + Number(confidence || 0)) / 2);
        existing.sample_size = Number(existing.sample_size || 1) + 1;
        existing.updated_at = updated_at;
      } else {
        this.db.globalIntelligence.push({ id, insight_type, case_type, strategy_pattern, lesson, impact_score, confidence, sample_size, source_hash, tags, created_at, updated_at });
      }
      return { success: true };
    }
    if (this.sql.includes("INSERT INTO digital_twin_state")) {
      const [organization_id, timestamp, environment_state, operational_state, risk_state, decision_state, last_updated] = this.params;
      this.db.digitalTwinStates.push({ organization_id, timestamp, environment_state, operational_state, risk_state, decision_state, last_updated });
      return { success: true };
    }
    return { success: true };
  }
}

export class MockKV {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
  }

  async get(key) {
    if (new TextEncoder().encode(String(key)).length >= 512) {
      throw new Error("KV GET failed: UTF-8 encoded length exceeds key length limit of 512");
    }
    return this.values.get(key) || null;
  }

  async put(key, value) {
    if (new TextEncoder().encode(String(key)).length >= 512) {
      throw new Error("KV PUT failed: UTF-8 encoded length exceeds key length limit of 512");
    }
    this.values.set(key, value);
  }
}

export function aiAlways(response) {
  return {
    calls: [],
    async run(model, payload) {
      this.calls.push({ model, payload });
      return { response };
    }
  };
}

export function testUser(overrides = {}) {
  return {
    user_id: "access:analyst@example.com",
    email: "analyst@example.com",
    role: "analyst",
    organization_id: "org-test",
    organization_name: "Org Test",
    ...overrides
  };
}

export function seedDigitalTwin(db, organizationId = "org-test") {
  db.digitalTwinStates.push({
    organization_id: organizationId,
    timestamp: "2026-04-22T10:00:00.000Z",
    environment_state: JSON.stringify({
      load_shedding: { stage: 4, status: "active" },
      market: { volatility_index: 0.52 },
      regulatory: { updates: [{ topic: "POPIA", severity: "high", summary: "Privacy controls under scrutiny." }] }
    }),
    operational_state: JSON.stringify({
      system_metrics: { uptime_pct: 98.4, cpu_load_pct: 82, queue_depth: 80 },
      service_health: "watch"
    }),
    risk_state: JSON.stringify({
      level: "high",
      score: 0.68,
      signals: [{ name: "load_shedding", value: 4, severity: "high" }]
    }),
    decision_state: JSON.stringify({}),
    last_updated: "2026-04-22T10:00:00.000Z"
  });
}
