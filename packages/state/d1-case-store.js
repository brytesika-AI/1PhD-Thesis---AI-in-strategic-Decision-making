export function emptyCaseState(caseId, userGoal = "") {
  return {
    case_id: caseId,
    created_at: new Date().toISOString(),
    current_stage: 1,
    status: "active",
    user_goal: userGoal,
    situational_briefing: {},
    evidence_bundle: {},
    assumptions: [],
    options: [],
    options_generated: [],
    objections: [],
    rebuttals: [],
    unresolved_tensions: [],
    consensus: {
      agreements: [],
      disagreements: [],
      unresolved_tensions: [],
      confidence_by_agent: {},
      level: "unknown",
      final_rationale: ""
    },
    decision: null,
    devil_advocate_findings: {},
    implementation_plan: {},
    monitoring_rules: [],
    audit_log_refs: [],
    audit_refs: [],
    stage_outputs: {},
    approval_gates: [],
    queues: {
      steering: [],
      follow_up: [],
      debate: []
    },
    loop: {
      iterations: 0,
      max_iterations: 12,
      last_agent_id: null,
      stop_reason: null
    },
    verification_chain: {
      devil_advocate_validated: false,
      policy_sentinel_validated: false,
      consensus_tracker_confirmed: false
    }
  };
}

export class D1CaseStore {
  constructor(db) {
    this.db = db;
  }

  async getCase(caseId) {
    const row = await this.db
      .prepare("SELECT payload FROM decision_cases WHERE case_id = ?")
      .bind(caseId)
      .first();
    return row?.payload ? JSON.parse(row.payload) : null;
  }

  async saveCase(caseState) {
    const payload = JSON.stringify(caseState);
    await this.db
      .prepare(
        `INSERT INTO decision_cases
          (case_id, status, current_stage, user_goal, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(case_id) DO UPDATE SET
          status = excluded.status,
          current_stage = excluded.current_stage,
          user_goal = excluded.user_goal,
          payload = excluded.payload,
          updated_at = CURRENT_TIMESTAMP`
      )
      .bind(
        caseState.case_id,
        caseState.status,
        caseState.current_stage,
        caseState.user_goal,
        payload
      )
      .run();
    return caseState;
  }

  async listCases(limit = 20) {
    const result = await this.db
      .prepare("SELECT payload FROM decision_cases ORDER BY updated_at DESC LIMIT ?")
      .bind(limit)
      .all();
    return (result.results || []).map((row) => JSON.parse(row.payload));
  }
}
