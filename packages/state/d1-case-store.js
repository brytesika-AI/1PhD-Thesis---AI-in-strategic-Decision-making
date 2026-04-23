export function emptyCaseState(caseId, userGoal = "") {
  return {
    case_id: caseId,
    created_at: new Date().toISOString(),
    current_stage: 1,
    status: "active",
    user_goal: userGoal,
    created_by: null,
    last_modified_by: null,
    organization_id: null,
    organization_name: null,
    situational_briefing: {},
    evidence_bundle: {},
    framework_selection: {
      primary_framework: null,
      secondary_frameworks: [],
      justification: "",
      classification: null,
      ranked_frameworks: [],
      tool_names: []
    },
    framework_selector_llm_enabled: false,
    frameworks: {
      porter: null,
      swot: null,
      pestle: null,
      value_chain: null,
      scenario_planning: null
    },
    framework_outputs: {
      porter: null,
      swot: null,
      pestle: null,
      value_chain: null,
      scenario: null
    },
    analysis: {
      industry: null,
      internal: null,
      environment: null,
      value_chain: null,
      scenarios: null
    },
    blended_analysis: {
      framework_contributors: [],
      top_risks: [],
      top_opportunities: [],
      top_constraints: [],
      top_strengths: [],
      strategic_options: [],
      conflicts: [],
      recommended_strategy: "",
      alternatives: [],
      key_tradeoffs: [],
      confidence: 0
    },
    narrative: null,
    narrative_mode: "board",
    assumptions: [],
    options: [],
    options_generated: [],
    objections: [],
    rebuttals: [],
    unresolved_tensions: [],
    revisions: [],
    policy_violations: [],
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
    memory: {
      episodic: [],
      semantic: [],
      procedural: []
    },
    shared_memory: {
      episodic: [],
      semantic: [],
      procedural: []
    },
    organizational_intelligence: {
      recommended_strategy: "Use governed evidence, challenge, and monitoring gates.",
      confidence: 0.5,
      based_on: []
    },
    digital_twin: null,
    simulation_mode_enabled: false,
    simulation: null,
    recommended_strategy: null,
    simulation_block: null,
    reflection: {},
    learning: {},
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

function parseCasePayload(payload, caseId = "unknown") {
  try {
    return payload ? JSON.parse(payload) : null;
  } catch (error) {
    throw new Error(`CASE_STATE_JSON_PARSE_FAILED for ${caseId}: ${error.message}`);
  }
}

export class D1CaseStore {
  constructor(db) {
    this.db = db;
  }

  async getCase(caseId, { organizationId = null } = {}) {
    const row = await this.db
      .prepare("SELECT payload FROM decision_cases WHERE case_id = ?")
      .bind(caseId)
      .first();
    const caseState = parseCasePayload(row?.payload, caseId);
    if (!caseState) return null;
    if (organizationId && caseState.organization_id !== organizationId) return null;
    return caseState;
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

  async listCases(limit = 20, { organizationId = null } = {}) {
    const result = await this.db
      .prepare("SELECT payload FROM decision_cases ORDER BY updated_at DESC LIMIT ?")
      .bind(Math.max(Number(limit || 20), 100))
      .all();
    const cases = (result.results || []).map((row) => parseCasePayload(row.payload, row.case_id)).filter(Boolean);
    const filtered = organizationId ? cases.filter((item) => item.organization_id === organizationId) : cases;
    return filtered.slice(0, limit);
  }
}
