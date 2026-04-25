import assert from "node:assert/strict";
import test from "node:test";

import { D1AuditLog } from "../../packages/audit/d1-audit-log.js";
import { DecisionLoop } from "../../packages/loop/decision-loop.js";
import { D1MemoryStore } from "../../packages/memory/d1-memory-store.js";
import { runSimulation } from "../../packages/simulation/simulation-engine.js";
import { D1CaseStore } from "../../packages/state/d1-case-store.js";
import { agentRegistry } from "../../apps/worker/src/config/agents.js";
import { MockD1, aiAlways, seedDigitalTwin, testUser } from "../helpers/mock-cloudflare.mjs";

function makeLoop({ db = new MockD1(), ai = null, cache = null, memoryStore = null, digitalTwin = null, simulation = null } = {}) {
  return {
    db,
    loop: new DecisionLoop({
      registryDocument: agentRegistry,
      caseStore: new D1CaseStore(db),
      auditLog: new D1AuditLog(db),
      ai,
      cache,
      memoryStore,
      digitalTwin,
      simulation,
      maxIterations: 14
    }),
    auditLog: new D1AuditLog(db)
  };
}

test("multi-agent loop chains tools, selects frameworks, retrieves memory, and never emits free-text agent output", async () => {
  const db = new MockD1();
  db.organizationMemory.push({
    id: "mem-1",
    organization_id: "org-test",
    memory_type: "procedural",
    content: JSON.stringify({ task_type: "cloud_migration", strategy_steps: ["pilot", "audit", "scale"], outcome: "success" }),
    tags: JSON.stringify(["cloud_migration", "strategy"]),
    confidence: 0.82,
    success_rate: 0.86,
    failure_count: 0,
    created_at: "2026-04-20T10:00:00.000Z",
    updated_at: "2026-04-21T10:00:00.000Z"
  });

  const { loop, auditLog } = makeLoop({
    db,
    ai: aiAlways("[object Object]"),
    memoryStore: new D1MemoryStore(db)
  });
  const result = await loop.run({
    caseId: "INT-LOOP",
    userGoal: "Cloud migration with load shedding + POPIA risk",
    maxIterations: 12,
    user: testUser()
  });
  const replay = await auditLog.replaySummary("INT-LOOP");

  assert.equal(result.stop_reason, "human_approval_required");
  assert.equal(result.case_state.status, "awaiting_approval");
  assert.equal(result.case_state.approval_gates.at(-1).type, "final_decision");
  assert.ok(result.case_state.framework_selection.primary_framework);
  assert.ok(result.case_state.framework_selection.tool_names.length >= 2);
  assert.ok(result.case_state.frameworks.pestle || result.case_state.frameworks.swot);
  assert.ok(result.case_state.blended_analysis.recommended_strategy);
  assert.equal(result.case_state.current_stage >= 7, true);
  assert.ok(replay.events.some((event) => event.event_type === "memory_retrieved"));
  assert.ok(replay.events.some((event) => event.event_type === "tool_execution_start"));
  assert.ok(replay.events.some((event) => event.event_type === "tool_execution_end"));

  for (const output of Object.values(result.case_state.stage_outputs)) {
    assert.notEqual(typeof output, "string", "agent returned free-text instead of tool result");
    assert.equal(typeof output, "object", "agent output must be structured JSON");
  }
});

test("failure injection: missing memory store data is logged and execution continues", async () => {
  const db = new MockD1();
  const failingMemoryStore = {
    async retrieve() {
      throw new Error("memory timeout");
    },
    async remember() {
      return { recorded_at: new Date().toISOString() };
    }
  };
  const { loop, auditLog } = makeLoop({ db, memoryStore: failingMemoryStore, ai: aiAlways("[object Object]") });
  const result = await loop.run({
    caseId: "INT-MEMORY-FAIL",
    userGoal: "Cloud migration with load shedding + POPIA risk",
    maxIterations: 12,
    user: testUser()
  });
  const replay = await auditLog.replaySummary("INT-MEMORY-FAIL");

  assert.equal(result.stop_reason, "human_approval_required");
  assert.equal(result.case_state.status, "awaiting_approval");
  assert.ok(replay.events.some((event) => event.event_type === "system_error" && event.output_summary === "memory timeout"));
  assert.ok(result.case_state.narrative.executive_summary);
});

test("stopped decision loop returns final state until an explicit reopen clears stop reason", async () => {
  const { loop, auditLog } = makeLoop({ ai: aiAlways("[object Object]") });
  const first = await loop.run({
    caseId: "INT-STOPPED",
    userGoal: "Cloud migration with load shedding + POPIA risk",
    maxIterations: 1,
    user: testUser()
  });
  const beforeReplay = await auditLog.replaySummary("INT-STOPPED");
  const beforeAgentStarts = beforeReplay.events.filter((event) => event.event_type === "agent_start").length;

  const second = await loop.run({
    caseId: "INT-STOPPED",
    userGoal: "Cloud migration with load shedding + POPIA risk",
    maxIterations: 12,
    user: testUser()
  });
  const afterReplay = await auditLog.replaySummary("INT-STOPPED");
  const afterAgentStarts = afterReplay.events.filter((event) => event.event_type === "agent_start").length;

  assert.equal(first.stop_reason, "max_iterations");
  assert.equal(second.stop_reason, "max_iterations");
  assert.equal(afterAgentStarts, beforeAgentStarts);
  assert.deepEqual(second.case_state.stage_outputs, first.case_state.stage_outputs);
});

test("decision loop refreshes digital twin when no latest organization state exists", async () => {
  const digitalTwin = {
    async getLatestTwinState() {
      return null;
    },
    async refreshTwinState({ organizationId }) {
      return {
        updated: [{
          organization_id: organizationId,
          timestamp: "2026-04-23T10:00:00.000Z",
          environment_state: { load_shedding: { stage: 4 } },
          operational_state: { system_metrics: { uptime_pct: 98.2 } },
          risk_state: { level: "high", score: 0.67 },
          decision_state: {},
          last_updated: "2026-04-23T10:00:00.000Z"
        }]
      };
    },
    async updateDecisionOutcome({ organizationId, caseState }) {
      return {
        ...caseState.digital_twin,
        organization_id: organizationId,
        decision_state: { last_case_id: caseState.case_id }
      };
    }
  };
  const { loop } = makeLoop({ ai: aiAlways("[object Object]"), digitalTwin });

  const result = await loop.run({
    caseId: "INT-TWIN-REFRESH",
    userGoal: "Cloud migration with load shedding + POPIA risk",
    maxIterations: 1,
    user: testUser({ organization_id: "org-refresh" })
  });

  assert.equal(result.case_state.digital_twin.organization_id, "org-refresh");
  assert.equal(result.case_state.digital_twin.risk_state.level, "high");
});

test("critical tool infrastructure failure stops loop without re-enqueueing degraded turns", async () => {
  const brokenCache = {
    async put() {},
    async get() {
      throw new Error("KV GET failed: UTF-8 encoded length exceeds key length limit of 512");
    }
  };
  const { loop, auditLog } = makeLoop({ cache: brokenCache, ai: null });
  const result = await loop.run({
    caseId: "INT-CRITICAL-KV",
    userGoal: "Cloud migration with load shedding + POPIA risk",
    maxIterations: 12,
    user: testUser()
  });
  const replay = await auditLog.replaySummary("INT-CRITICAL-KV");

  assert.equal(result.stop_reason, "critical_tool_failure");
  assert.equal(result.case_state.status, "critical_failure");
  assert.match(result.case_state.critical_failure.reason, /CRITICAL TOOL FAILURE/);
  assert.equal(result.case_state.queues.steering.length, 0);
  assert.equal(result.case_state.queues.follow_up.length, 0);
  assert.equal(result.case_state.queues.debate.length, 0);
  assert.ok(replay.events.some((event) => event.event_type === "system_error"));
});

test("simulation uses digital twin baseline and returns scored best strategy", async () => {
  const db = new MockD1();
  seedDigitalTwin(db, "org-test");
  const state = {
    case_id: "INT-SIM",
    organization_id: "org-test",
    user: testUser(),
    user_goal: "Cloud migration with load shedding + POPIA risk",
    digital_twin: {
      organization_id: "org-test",
      environment_state: {
        load_shedding: { stage: 4 },
        market: { volatility_index: 0.52 },
        regulatory: { updates: [{ topic: "POPIA", severity: "high" }] }
      },
      operational_state: { system_metrics: { cpu_load_pct: 82, queue_depth: 80 } },
      risk_state: { level: "high", score: 0.68 }
    }
  };

  const result = await runSimulation(state, { DB: db, AI: aiAlways("[object Object]"), SIMULATION_RISK_THRESHOLD: "0.99" });

  assert.ok(result.best_strategy);
  assert.equal(result.simulation_summary.length, 3);
  assert.ok(result.simulation_summary.some((item) => item.conditions.load_shedding_stage_delta > 0));
  for (const item of result.simulation_summary) {
    assert.equal(typeof item.outcome.risk_score, "number");
    assert.equal(typeof item.outcome.success_probability, "number");
  }
});
