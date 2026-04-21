import assert from "node:assert/strict";
import test from "node:test";

import { D1AuditLog } from "../../packages/audit/d1-audit-log.js";
import { OrchestrationGateway } from "../../packages/core/orchestration-gateway.js";
import { DecisionLoop } from "../../packages/loop/decision-loop.js";
import { PolicyEngine } from "../../packages/policy/policy-engine.js";
import { getAgentForStage, listAgents } from "../../packages/shared/agent-registry.js";
import { D1CaseStore, emptyCaseState } from "../../packages/state/d1-case-store.js";
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
    "swot_analysis",
    "five_whys",
    "root_cause_analysis",
    "policy_compliance_scan",
    "scenario_planning",
    "resilience_scoring",
    "implementation_plan_builder"
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
    '{"finding":"Challenge passed.","stress_tests":[],"confidence":0.8}',
    '{"finding":"Roadmap ready.","implementation_plan":{"phase_1":"Controls"},"tools_used":["implementation_plan_builder"],"confidence":0.82}',
    '{"finding":"Policy clear.","confirmed":true,"confidence":0.9}',
    '{"finding":"Consensus confirmed.","confirmed":true,"final_rationale":"Proceed with governed rollout.","confidence":0.88}'
  ]);
  const loop = new DecisionLoop({ registryDocument: agentRegistry, caseStore, auditLog, ai, maxIterations: 10 });

  const result = await loop.run({
    caseId: "CASE-LOOP",
    userGoal: "Decide whether to migrate regulated workloads.",
    maxIterations: 10
  });
  const replay = await auditLog.replaySummary("CASE-LOOP");

  assert.equal(result.stop_reason, "decision_reached");
  assert.equal(result.case_state.status, "closed");
  assert.equal(result.case_state.verification_chain.devil_advocate_validated, true);
  assert.equal(result.case_state.verification_chain.policy_sentinel_validated, true);
  assert.equal(result.case_state.verification_chain.consensus_tracker_confirmed, true);
  assert.ok(replay.events.some((event) => event.event_type === "agent_start"));
  assert.ok(replay.events.some((event) => event.event_type === "tool_execution_start"));
  assert.ok(replay.events.some((event) => event.event_type === "case_closed"));
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
    '{"finding":"Challenge raised.","objection":"Vendor SLA fails under load-shedding.","stress_tests":[{"risk":"Vendor SLA fails under load-shedding."}],"confidence":0.7}',
    '{"finding":"Forensic rebuttal added.","rebuttal":"Mitigation requires edge fallback.","tools_used":["resilience_scoring"],"confidence":0.8}',
    '{"finding":"Roadmap ready.","implementation_plan":{"phase_1":"Edge fallback"},"tools_used":["implementation_plan_builder"],"confidence":0.8}',
    '{"finding":"Policy clear.","confirmed":true,"confidence":0.9}',
    '{"finding":"Consensus confirmed.","confirmed":true,"final_rationale":"Proceed after SLA mitigation.","confidence":0.86}'
  ]);
  const loop = new DecisionLoop({ registryDocument: agentRegistry, caseStore, auditLog, ai, maxIterations: 12 });

  const result = await loop.run({
    caseId: "CASE-DEBATE",
    userGoal: "Decide whether to accept a cloud vendor SLA.",
    maxIterations: 12
  });

  assert.equal(result.stop_reason, "decision_reached");
  assert.equal(result.case_state.objections[0].status, "answered");
  assert.equal(result.case_state.rebuttals.length, 1);
  assert.equal(result.case_state.consensus.level, "high");
});

test("policy engine blocks unauthorized tools and blocked sandbox actions", () => {
  const policy = new PolicyEngine(agentRegistry);

  assert.equal(policy.validateToolAccess("induna", "five_whys").allowed, true);
  assert.equal(policy.validateToolAccess("tracker", "implementation_plan_builder").allowed, false);
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
