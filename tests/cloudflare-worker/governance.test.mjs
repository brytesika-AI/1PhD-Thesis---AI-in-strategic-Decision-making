import assert from "node:assert/strict";
import test from "node:test";

import { D1AuditLog } from "../../packages/audit/d1-audit-log.js";
import { OrchestrationGateway } from "../../packages/core/orchestration-gateway.js";
import { DecisionLoop } from "../../packages/loop/decision-loop.js";
import { D1MemoryStore } from "../../packages/memory/d1-memory-store.js";
import { PolicyEngine } from "../../packages/policy/policy-engine.js";
import { getAgentForStage, listAgents } from "../../packages/shared/agent-registry.js";
import { D1CaseStore, emptyCaseState } from "../../packages/state/d1-case-store.js";
import worker from "../../apps/worker/src/index.js";
import { agentRegistry } from "../../apps/worker/src/config/agents.js";

const requiredFields = [
  "id",
  "display_name",
  "role",
  "system_prompt_path",
  "allowed_tools",
  "output_schema",
  "handoff_rules",
  "requires_human_approval",
  "max_context_chars",
  "monitoring_triggers"
];

class MockD1 {
  constructor() {
    this.cases = new Map();
    this.auditEvents = [];
    this.episodicMemory = [];
    this.semanticMemory = [];
    this.proceduralMemory = new Map();
    this.organizationMemory = [];
    this.agentLearningLog = [];
    this.digitalTwinStates = [];
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
    if (this.sql.includes("SELECT DISTINCT organization_id FROM users")) {
      return { results: [] };
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
        existing.success_rate = Math.min(0.99, Math.max(0.01, ((Number(existing.success_rate) + Number(success_rate)) / 2) + Number(successAdjustment)));
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
    if (this.sql.includes("INSERT INTO digital_twin_state")) {
      const [organization_id, timestamp, environment_state, operational_state, risk_state, decision_state, last_updated] = this.params;
      this.db.digitalTwinStates.push({ organization_id, timestamp, environment_state, operational_state, risk_state, decision_state, last_updated });
      return { success: true };
    }
    return { success: true };
  }
}

class MockKV {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key) || null;
  }

  async put(key, value) {
    this.values.set(key, value);
  }
}

class MockR2 {
  constructor() {
    this.objects = new Map();
  }

  async put(key, value) {
    this.objects.set(key, value);
  }

  async get(key) {
    return this.objects.get(key) || null;
  }
}

function aiWithResponses(responses) {
  let index = 0;
  return {
    calls: [],
    async run(model, payload) {
      this.calls.push({ model, payload });
      const prompt = payload?.messages?.find((message) => message.role === "user")?.content?.trim() || "";
      if (
        prompt.startsWith("Analyze using Porter's Five Forces") ||
        prompt.startsWith("Perform SWOT analysis") ||
        prompt.startsWith("Perform PESTLE analysis") ||
        prompt.startsWith("Perform Value Chain Analysis") ||
        prompt.startsWith("Perform Scenario Planning")
      ) {
        return { response: "{}" };
      }
      const response = responses[index] || responses.at(-1) || "{}";
      index += 1;
      return { response };
    }
  };
}

function makeGateway(responses) {
  const db = new MockD1();
  const caseStore = new D1CaseStore(db);
  const auditLog = new D1AuditLog(db);
  const ai = aiWithResponses(responses);
  return {
    db,
    ai,
    caseStore,
    auditLog,
    gateway: new OrchestrationGateway({
      registryDocument: agentRegistry,
      caseStore,
      auditLog,
      ai
    })
  };
}

test("agent registry loads all AI-SRF and control agents with required fields and valid tools", () => {
  const agents = listAgents(agentRegistry);
  const allAgents = Object.values(agentRegistry.agents);
  const knownSkills = new Set([
    "root_cause_analysis",
    "gather_evidence",
    "extract_assumptions",
    "generate_options",
    "generate_objections",
    "build_implementation_plan",
    "generate_monitoring_rules",
    "validate_policy",
    "validate_consensus",
    "extract_memory",
    "reflect_on_decision",
    "extract_learning",
    "generate_scenarios",
    "evaluate_outcome",
    "run_porters_five_forces",
    "run_swot_analysis",
    "run_pestle_analysis",
    "run_value_chain_analysis",
    "run_scenario_planning"
  ]);

  assert.equal(agents.length, 7);
  assert.equal(allAgents.length, 10);
  assert.deepEqual(agents.map((agent) => agent.id), [
    "tracker",
    "induna",
    "auditor",
    "innovator",
    "challenger",
    "architect",
    "guardian"
  ]);

  for (const agent of allAgents) {
    for (const field of requiredFields) {
      assert.ok(field in agent, `${agent.id} missing ${field}`);
    }
    for (const toolName of agent.allowed_tools) {
      assert.ok(knownSkills.has(toolName), `${agent.id} references unknown tool ${toolName}`);
    }
  }
});

test("stateful decision loop emits events, executes tools, and reaches a governed decision", async () => {
  const db = new MockD1();
  const caseStore = new D1CaseStore(db);
  const auditLog = new D1AuditLog(db);
  const ai = aiWithResponses([
    '{"finding":"Briefing complete.","signals":[{"name":"grid","severity":"high"}],"tools_used":["policy_compliance_scan"],"confidence":0.81}',
    '{"finding":"Assumptions mapped.","assumptions":["Cloud exit plan exists."],"tools_used":["five_whys"],"confidence":0.76}',
    '{"finding":"Evidence verified.","evidence":{"policy":"King IV"},"tools_used":["resilience_scoring"],"confidence":0.78}',
    '{"finding":"Options generated.","options":[{"id":"A","name":"Governed migration"}],"tools_used":["scenario_planning"],"confidence":0.74}',
    '{"finding":"Challenge raised.","objection":"Cloud exit plan may fail during infrastructure stress.","stress_tests":[{"risk":"Cloud exit plan may fail during infrastructure stress."}],"verdict":"Proceed only with fallback controls.","tools_used":["swot_analysis"],"confidence":0.8}',
    '{"finding":"Forensic rebuttal added.","evidence":{"fallback_control":"edge failover"},"rebuttal":"Fallback controls reduce the exit-plan risk.","tools_used":["resilience_scoring"],"confidence":0.81}',
    '{"finding":"Roadmap ready.","implementation_plan":{"phase_1":"Controls"},"tools_used":["implementation_plan_builder"],"confidence":0.82}',
    '{"finding":"Monitoring rules ready.","risk_signals":[{"name":"decision_drift","level":"medium"}],"monitoring_rules":[{"metric":"decision_drift","threshold":"medium"}],"alert_thresholds":[{"metric":"decision_drift","red":"high"}],"tools_used":["resilience_scoring"],"confidence":0.84}',
    '{"finding":"Policy clear.","confirmed":true,"tools_used":["policy_compliance_scan"],"confidence":0.9}',
    '{"finding":"Consensus confirmed.","confirmed":true,"final_rationale":"Proceed with governed rollout.","confidence":0.88}'
  ]);
  const loop = new DecisionLoop({ registryDocument: agentRegistry, caseStore, auditLog, ai, maxIterations: 10 });

  const result = await loop.run({
    caseId: "CASE-LOOP",
    userGoal: "Decide whether to migrate regulated workloads.",
    maxIterations: 10
  });
  const replay = await auditLog.replaySummary("CASE-LOOP");

  assert.equal(result.stop_reason, "human_approval_required");
  assert.equal(result.case_state.status, "awaiting_approval");
  assert.equal(result.case_state.approval_gates.at(-1).type, "final_decision");
  assert.equal(result.case_state.verification_chain.devil_advocate_validated, true);
  assert.equal(result.case_state.verification_chain.policy_sentinel_validated, true);
  assert.equal(result.case_state.verification_chain.consensus_tracker_confirmed, true);
  assert.ok(result.case_state.framework_selection.primary_framework);
  assert.ok(result.case_state.framework_selection.tool_names.length >= 1);
  assert.ok(Object.values(result.case_state.frameworks).some(Boolean));
  assert.ok(result.case_state.blended_analysis.recommended_strategy);
  assert.ok(result.case_state.narrative.executive_summary);
  assert.ok(result.case_state.narrative.recommended_action);
  assert.ok(replay.events.some((event) => event.event_type === "agent_start"));
  assert.ok(replay.events.some((event) => event.event_type === "framework_selected"));
  assert.ok(replay.events.some((event) => event.event_type === "narrative_generated"));
  assert.ok(replay.events.some((event) => event.event_type === "tool_execution_start"));
  assert.ok(replay.events.some((event) => event.event_type === "queue_enqueued"));
  assert.ok(replay.events.some((event) => event.event_type === "consensus_updated"));
  assert.ok(replay.events.some((event) => event.event_type === "human_escalation_required"));
});

test("decision loop routes Devil's Advocate objections through debate queue", async () => {
  const db = new MockD1();
  const caseStore = new D1CaseStore(db);
  const auditLog = new D1AuditLog(db);
  const ai = aiWithResponses([
    '{"finding":"Briefing complete.","signals":[],"tools_used":["policy_compliance_scan"],"confidence":0.8}',
    '{"finding":"Assumptions mapped.","assumptions":["Vendor SLA is resilient."],"tools_used":["five_whys"],"confidence":0.72}',
    '{"finding":"Evidence verified.","evidence":{"sla":"weak"},"tools_used":["resilience_scoring"],"confidence":0.72}',
    '{"finding":"Options generated.","options":[{"id":"A"}],"tools_used":["scenario_planning"],"confidence":0.71}',
    '{"finding":"Challenge raised.","objection":"Vendor SLA fails under load-shedding.","stress_tests":[{"risk":"Vendor SLA fails under load-shedding."}],"verdict":"Proceed only with edge fallback.","tools_used":["swot_analysis"],"confidence":0.7}',
    '{"finding":"Forensic rebuttal added.","evidence":{"mitigation":"edge fallback"},"rebuttal":"Mitigation requires edge fallback.","tools_used":["resilience_scoring"],"confidence":0.8}',
    '{"finding":"Roadmap ready.","implementation_plan":{"phase_1":"Edge fallback"},"tools_used":["implementation_plan_builder"],"confidence":0.8}',
    '{"finding":"Monitoring rules ready.","risk_signals":[{"name":"sla_resilience","level":"green"}],"monitoring_rules":[{"metric":"sla_resilience","threshold":"green"}],"alert_thresholds":[{"metric":"sla_resilience","red":"amber"}],"tools_used":["resilience_scoring"],"confidence":0.83}',
    '{"finding":"Policy clear.","confirmed":true,"tools_used":["policy_compliance_scan"],"confidence":0.9}',
    '{"finding":"Consensus confirmed.","confirmed":true,"final_rationale":"Proceed after SLA mitigation.","confidence":0.86}'
  ]);
  const loop = new DecisionLoop({ registryDocument: agentRegistry, caseStore, auditLog, ai, maxIterations: 12 });

  const result = await loop.run({
    caseId: "CASE-DEBATE",
    userGoal: "Decide whether to accept a cloud vendor SLA.",
    maxIterations: 12
  });

  assert.equal(result.stop_reason, "human_approval_required");
  assert.equal(result.case_state.status, "awaiting_approval");
  assert.equal(result.case_state.objections[0].status, "answered");
  assert.equal(result.case_state.rebuttals.length, 1);
  assert.equal(result.case_state.consensus.level, "high");
  const replay = await auditLog.replaySummary("CASE-DEBATE");
  assert.ok(replay.events.some((event) => event.event_type === "objection_raised"));
  assert.ok(replay.events.some((event) => event.event_type === "rebuttal_added"));
});

test("policy engine blocks unauthorized tools and blocked sandbox actions", () => {
  const policy = new PolicyEngine(agentRegistry);

  assert.equal(policy.validateToolAccess("induna", "extract_assumptions").allowed, true);
  assert.equal(policy.validateToolAccess("tracker", "build_implementation_plan").allowed, false);
  assert.equal(policy.validateToolAccess("tracker", "shell").allowed, false);
  assert.equal(policy.validateUploadMetadata("board-pack.pdf", 2048).allowed, true);
  assert.equal(policy.validateUploadMetadata("payload.ps1", 2048).allowed, false);
  assert.equal(policy.validateExternalDataAccess("https://facebook.com/example"), false);
});

test("D1 case state persists, reloads, and remains mockable", async () => {
  const db = new MockD1();
  const store = new D1CaseStore(db);
  const state = emptyCaseState("CASE-D1", "Govern a market-entry decision.");
  state.current_stage = 3;
  state.assumptions.push("Grid stability will improve.");

  await store.saveCase(state);
  const reloaded = await store.getCase("CASE-D1");
  const cases = await store.listCases();

  assert.equal(reloaded.current_stage, 3);
  assert.deepEqual(reloaded.assumptions, ["Grid stability will improve."]);
  assert.equal(cases.length, 1);
});

test("audit log records ordered agent runs and replay returns chronological events", async () => {
  const db = new MockD1();
  const audit = new D1AuditLog(db);

  await audit.logEvent({
    event_id: "evt-2",
    event_type: "agent_execution",
    timestamp: "2026-04-21T10:02:00.000Z",
    case_id: "CASE-AUDIT",
    agent_id: "induna",
    tools_used: ["five_whys"]
  });
  await audit.logEvent({
    event_id: "evt-1",
    event_type: "agent_execution",
    timestamp: "2026-04-21T10:01:00.000Z",
    case_id: "CASE-AUDIT",
    agent_id: "tracker",
    tools_used: ["policy_compliance_scan"]
  });

  const replay = await audit.replaySummary("CASE-AUDIT");

  assert.deepEqual(replay.agents, ["tracker", "induna"]);
  assert.deepEqual(replay.tools_used, ["five_whys", "policy_compliance_scan"]);
});

test("Worker exposes replayable case events as an event stream", async () => {
  const db = new MockD1();
  const audit = new D1AuditLog(db);
  const store = new D1CaseStore(db);
  const state = emptyCaseState("CASE-STREAM", "Stream events.");
  state.organization_id = "default-org";
  await store.saveCase(state);

  await audit.logEvent({
    event_id: "evt-stream-1",
    event_type: "agent_start",
    timestamp: "2026-04-21T10:01:00.000Z",
    case_id: "CASE-STREAM",
    agent_id: "tracker",
    output_summary: "Tracker started."
  });

  const response = await worker.fetch(
    new Request("https://example.test/api/cases/CASE-STREAM/events", {
      headers: {
        accept: "text/event-stream",
        "Cf-Access-Authenticated-User-Email": "exec@example.com"
      }
    }),
    { DB: db },
    { waitUntil() {} }
  );
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.ok(response.headers.get("content-type").includes("text/event-stream"));
  assert.ok(text.includes("event: agent_start"));
  assert.ok(text.includes("Tracker started."));
});

test("Worker decision run endpoint is gated to analyst and admin roles", async () => {
  const db = new MockD1();
  const ai = aiWithResponses([
    '{"finding":"Briefing complete.","signals":[{"name":"grid","severity":"high"}],"tools_used":["policy_compliance_scan"],"confidence":0.81}'
  ]);

  const executiveResponse = await worker.fetch(
    new Request("https://example.test/api/decision/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cf-Access-Authenticated-User-Email": "exec@example.com",
        "X-AI-SRF-Role": "executive"
      },
      body: JSON.stringify({ case_id: "CASE-RUN-EXEC", entry_stage: 1 })
    }),
    { DB: db, AI: ai },
    { waitUntil() {} }
  );

  const analystResponse = await worker.fetch(
    new Request("https://example.test/api/decision/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cf-Access-Authenticated-User-Email": "analyst@example.com",
        "X-AI-SRF-Role": "analyst"
      },
      body: JSON.stringify({ case_id: "CASE-RUN-ANALYST", entry_stage: 1, max_iterations: 1 })
    }),
    { DB: db, AI: ai },
    { waitUntil() {} }
  );
  const payload = await analystResponse.json();

  assert.equal(executiveResponse.status, 403);
  assert.equal(analystResponse.status, 200);
  assert.equal(payload.case_state.created_by, "access:analyst@example.com");
});

test("Worker CORS allows Cloudflare Pages origin with credentials", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/api/decision/run", {
      method: "OPTIONS",
      headers: {
        Origin: "https://436ee841.ai-srf-cloudflare.pages.dev",
        "Access-Control-Request-Method": "POST"
      }
    }),
    { DB: new MockD1() },
    { waitUntil() {} }
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://436ee841.ai-srf-cloudflare.pages.dev");
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
  assert.ok(response.headers.get("Access-Control-Allow-Headers").includes("Content-Type"));
});

test("Worker digital twin endpoint updates and returns organization-scoped state", async () => {
  const db = new MockD1();
  const env = {
    DB: db,
    MOCK_LOAD_SHEDDING_STAGE: "4",
    MOCK_CPU_LOAD_PCT: "82",
    MOCK_MARKET_VOLATILITY: "0.56"
  };
  const headers = {
    "Content-Type": "application/json",
    "Cf-Access-Authenticated-User-Email": "analyst@example.com",
    "X-AI-SRF-Role": "analyst",
    "X-AI-SRF-Org": "org-twin"
  };

  const updateResponse = await worker.fetch(
    new Request("https://example.test/api/digital-twin/update", {
      method: "POST",
      headers,
      body: "{}"
    }),
    env,
    { waitUntil() {} }
  );
  const getResponse = await worker.fetch(
    new Request("https://example.test/api/digital-twin", {
      method: "GET",
      headers
    }),
    env,
    { waitUntil() {} }
  );
  const payload = await getResponse.json();

  assert.equal(updateResponse.status, 200);
  assert.equal(getResponse.status, 200);
  assert.equal(payload.digital_twin.organization_id, "org-twin");
  assert.equal(payload.digital_twin.environment_state.load_shedding.stage, 4);
  assert.ok(["medium", "high", "critical"].includes(payload.digital_twin.risk_state.level));
  assert.ok(db.auditEvents.some((event) => event.event_type === "digital_twin_updated"));
});

test("Worker command interface endpoints update state and log audit actions", async () => {
  const db = new MockD1();
  const ai = aiWithResponses([
    '{"finding":"Briefing complete.","signals":[{"name":"grid","severity":"high"}],"tools_used":["policy_compliance_scan"],"confidence":0.81}',
    '{"finding":"Briefing complete.","signals":[{"name":"assumption_gap","severity":"medium"}],"tools_used":["policy_compliance_scan"],"confidence":0.8}'
  ]);
  const env = { DB: db, AI: ai };
  const headers = {
    "Content-Type": "application/json",
    "Cf-Access-Authenticated-User-Email": "analyst@example.com",
    "X-AI-SRF-Role": "analyst"
  };

  const stressResponse = await worker.fetch(
    new Request("https://example.test/api/decision/stress-test", {
      method: "POST",
      headers,
      body: JSON.stringify({ case_id: "CASE-COMMAND", entry_stage: 1, max_iterations: 1, user_goal: "Stress test." })
    }),
    env,
    { waitUntil() {} }
  );
  const challengeResponse = await worker.fetch(
    new Request("https://example.test/api/decision/challenge-assumptions", {
      method: "POST",
      headers,
      body: JSON.stringify({ case_id: "CASE-COMMAND", entry_stage: 1, max_iterations: 1, user_goal: "Challenge assumptions." })
    }),
    env,
    { waitUntil() {} }
  );
  const reopenResponse = await worker.fetch(
    new Request("https://example.test/api/decision/reopen", {
      method: "POST",
      headers,
      body: JSON.stringify({ case_id: "CASE-COMMAND", entry_stage: 1, user_goal: "Reopen case." })
    }),
    env,
    { waitUntil() {} }
  );
  const reopenPayload = await reopenResponse.json();
  const replay = await new D1AuditLog(db).replaySummary("CASE-COMMAND");
  const actions = replay.events.map((event) => event.action);

  assert.equal(stressResponse.status, 200);
  assert.equal(challengeResponse.status, 200);
  assert.equal(reopenResponse.status, 200);
  assert.equal(reopenPayload.case_state.status, "active");
  assert.ok(actions.includes("stress_test_decision"));
  assert.ok(actions.includes("challenge_assumptions"));
  assert.ok(actions.includes("case_reopened"));
});

test("Worker simulation command runs scenarios before decision and records results", async () => {
  const db = new MockD1();
  const env = {
    DB: db,
    AI: null,
    SIMULATION_RISK_THRESHOLD: "0.95"
  };
  const headers = {
    "Content-Type": "application/json",
    "Cf-Access-Authenticated-User-Email": "analyst@example.com",
    "X-AI-SRF-Role": "analyst",
    "X-AI-SRF-Org": "org-sim"
  };

  const response = await worker.fetch(
    new Request("https://example.test/api/decision/simulate", {
      method: "POST",
      headers,
      body: JSON.stringify({
        case_id: "CASE-SIM",
        entry_stage: 1,
        user_goal: "Simulate cloud migration before execution.",
        max_iterations: 16
      })
    }),
    env,
    { waitUntil() {} }
  );
  const payload = await response.json();
  const replay = await new D1AuditLog(db).replaySummary("CASE-SIM");

  assert.equal(response.status, 200);
  assert.equal(payload.case_state.simulation_mode_enabled, true);
  assert.ok(payload.case_state.simulation.best_strategy);
  assert.ok(payload.case_state.simulation.simulation_summary.length >= 3);
  assert.ok(replay.events.some((event) => event.event_type === "simulation_completed"));
  assert.ok(db.episodicMemory.some((row) => row.event_type === "simulation_completed"));
});

test("stage handoff advances from Environmental Monitor to Socratic Partner", async () => {
  const { gateway, caseStore } = makeGateway([
    '{"finding":"Briefing complete.","signals":[{"name":"grid","severity":"high"}],"tools_used":["policy_compliance_scan"]}'
  ]);

  const result = await gateway.executeStage({
    caseId: "CASE-HANDOFF",
    stage: 1,
    userGoal: "Assess infrastructure risk.",
    riskState: "ELEVATED",
    sector: "financial_services"
  });
  const state = await caseStore.getCase("CASE-HANDOFF");

  assert.equal(result.agent, "The Tracker");
  assert.equal(getAgentForStage(agentRegistry, state.current_stage).id, "induna");
  assert.equal(state.stage_outputs["1"].finding, "Briefing complete.");
});

test("Monitoring Agent can re-trigger assumption review when assumptions fail", async () => {
  const { gateway, caseStore, auditLog } = makeGateway([
    '{"finding":"Monitoring active.","monitoring_rules":[{"metric":"assumption_validity"}],"tools_used":["resilience_scoring"]}'
  ]);
  const state = emptyCaseState("CASE-MONITOR", "Monitor decision assumptions.");
  state.status = "monitoring";
  state.current_stage = 7;
  state.assumptions = ["Eskom outage risk remains stable."];
  await caseStore.saveCase(state);

  const result = await gateway.evaluateMonitoring({
    caseId: "CASE-MONITOR",
    failedAssumptions: ["Eskom outage risk remains stable."],
    trigger: "assumption_failure"
  });
  const reloaded = await caseStore.getCase("CASE-MONITOR");
  const replay = await auditLog.replaySummary("CASE-MONITOR");

  assert.equal(result.re_trigger_required, true);
  assert.equal(result.re_trigger_stage, 2);
  assert.equal(reloaded.current_stage, 2);
  assert.equal(reloaded.status, "monitoring_retriggered");
  assert.equal(replay.events.at(-1).event_type, "monitoring_retrigger");
});

test("end-to-end synthetic case reaches Implementation Scaffolding with approvals", async () => {
  const { gateway, caseStore, auditLog } = makeGateway([
    '{"finding":"Briefing complete.","signals":[{"name":"regulation","severity":"medium"}],"tools_used":["policy_compliance_scan"]}',
    '{"finding":"Diagnosis complete.","assumptions":["Board appetite is moderate."],"tools_used":["five_whys"]}',
    '{"finding":"Forensic complete.","evidence":{"policy":"King IV"},"tools_used":["resilience_scoring"]}',
    '{"finding":"Options complete.","options":[{"id":"A","name":"Governed rollout"}],"tools_used":["scenario_planning"]}',
    '{"finding":"Stress complete.","stress_tests":[{"option":"A","risk":"Evidence gap"}],"tools_used":["swot_analysis"]}',
    '{"finding":"Roadmap complete.","implementation_plan":{"phase_1":"Control baseline"},"tools_used":["implementation_plan_builder"]}'
  ]);

  for (let stage = 1; stage <= 6; stage += 1) {
    const result = await gateway.executeStage({
      caseId: "CASE-E2E",
      stage,
      userGoal: `Stage ${stage} decision input.`,
      riskState: "ELEVATED",
      sector: "financial_services"
    });
    if (result.approval_required) {
      await gateway.decideApproval({
        caseId: "CASE-E2E",
        approvalId: result.approval_gate.approval_id,
        approved: true,
        reviewer: "node-test",
        notes: "Synthetic approval."
      });
    }
  }

  const state = await caseStore.getCase("CASE-E2E");
  const replay = await auditLog.replaySummary("CASE-E2E");

  assert.equal(state.current_stage, 7);
  assert.equal(state.stage_outputs["6"].finding, "Roadmap complete.");
  assert.ok(replay.agents.includes("tracker"));
  assert.ok(replay.agents.includes("architect"));
  assert.ok(replay.event_count >= 10);
});

test("Cloudflare adapter boundaries use mockable D1, KV, and R2 shapes", async () => {
  const db = new MockD1();
  const kv = new MockKV();
  const r2 = new MockR2();
  const store = new D1CaseStore(db);

  await kv.put("registry_version", "test");
  await r2.put("evidence/CASE-BOUNDARY.json", JSON.stringify({ source: "synthetic" }));
  await store.saveCase(emptyCaseState("CASE-BOUNDARY", "Adapter boundary check."));

  assert.equal(await kv.get("registry_version"), "test");
  assert.equal(await r2.get("evidence/CASE-BOUNDARY.json"), '{"source":"synthetic"}');
  assert.equal((await store.getCase("CASE-BOUNDARY")).case_id, "CASE-BOUNDARY");
});

test("decision loop retrieves and writes episodic, semantic, and procedural memory", async () => {
  const db = new MockD1();
  const caseStore = new D1CaseStore(db);
  const auditLog = new D1AuditLog(db);
  const memoryStore = new D1MemoryStore(db);
  db.proceduralMemory.set("org-memory:cloud_migration", {
    id: "proc-existing",
    user_id: "access:analyst@example.com",
    organization_id: "org-memory",
    task_type: "cloud_migration",
    strategy_steps: JSON.stringify(["migrate with backup", "verify controls", "monitor drift"]),
    success_rate: 0.6,
    failure_count: 1,
    last_used: "2026-04-20T10:00:00.000Z"
  });
  const loop = new DecisionLoop({
    registryDocument: agentRegistry,
    caseStore,
    auditLog,
    ai: null,
    memoryStore,
    maxIterations: 10
  });

  const result = await loop.run({
    caseId: "CASE-MEMORY",
    userGoal: "Decide whether to migrate customer analytics workloads to cloud.",
    maxIterations: 10,
    user: {
      user_id: "access:analyst@example.com",
      organization_id: "org-memory",
      organization_name: "Org Memory"
    }
  });
  const learned = db.proceduralMemory.get("org-memory:cloud_migration");
  const replay = await auditLog.replaySummary("CASE-MEMORY");

  assert.equal(result.stop_reason, "human_approval_required");
  assert.equal(result.case_state.status, "awaiting_approval");
  assert.equal(result.case_state.memory.procedural[0].task_type, "cloud_migration");
  assert.ok(db.episodicMemory.length >= 1);
  assert.ok(db.semanticMemory.length >= 1);
  assert.ok(db.organizationMemory.length >= 1);
  assert.ok(db.agentLearningLog.length >= 3);
  assert.ok(Number(learned.success_rate) > 0.6);
  assert.equal(result.case_state.shared_memory.procedural[0].task_type, "cloud_migration");
  assert.ok(result.case_state.organizational_intelligence.based_on.length >= 1);
  assert.ok(replay.events.some((event) => event.event_type === "memory_retrieved"));
  assert.ok(replay.events.some((event) => event.event_type === "memory_written"));
  assert.ok(replay.events.some((event) => event.event_type === "reflection_completed"));
  assert.ok(replay.events.some((event) => event.event_type === "learning_extracted"));
});

test("production assumptions point to Cloudflare rather than an always-on server", async () => {
  const runtimeConfig = await import("../../packages/shared/runtime-config.js");
  const config = {
    runtime: {
      production_target: "cloudflare",
      gateway_mode: "control_plane",
      engine_mode: "stateful_agent_loop",
      routing: { allow_dynamic_agent_skips: false },
      sandbox_policy: { blocked_by_default: true },
      event_hooks: { on_stage_completed: ["audit_event"] }
    }
  };

  assert.equal(runtimeConfig.validateRuntimeConfig(config).production_target, "cloudflare");
});
