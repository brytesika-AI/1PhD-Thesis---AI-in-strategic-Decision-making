import assert from "node:assert/strict";
import test from "node:test";

import { D1AuditLog } from "../../packages/audit/d1-audit-log.js";
import { DecisionLoop } from "../../packages/loop/decision-loop.js";
import { D1MemoryStore } from "../../packages/memory/d1-memory-store.js";
import { runSimulation } from "../../packages/simulation/simulation-engine.js";
import { D1CaseStore } from "../../packages/state/d1-case-store.js";
import { agentRegistry } from "../../apps/worker/src/config/agents.js";
import { MockD1, aiAlways, seedDigitalTwin, testUser } from "../helpers/mock-cloudflare.mjs";

function latestTwin(db, organizationId) {
  const row = db.digitalTwinStates
    .filter((item) => item.organization_id === organizationId)
    .sort((left, right) => right.last_updated.localeCompare(left.last_updated))[0];
  return row
    ? {
        organization_id: row.organization_id,
        timestamp: row.timestamp,
        environment_state: JSON.parse(row.environment_state),
        operational_state: JSON.parse(row.operational_state),
        risk_state: JSON.parse(row.risk_state),
        decision_state: JSON.parse(row.decision_state),
        last_updated: row.last_updated
      }
    : null;
}

test("full AI_SRF scenario completes with frameworks, blending, simulation, twin, memory, and narrative", async () => {
  const db = new MockD1();
  const user = testUser({ organization_id: "org-e2e", organization_name: "Org E2E" });
  seedDigitalTwin(db, "org-e2e");
  db.organizationMemory.push({
    id: "e2e-proc",
    organization_id: "org-e2e",
    memory_type: "procedural",
    content: JSON.stringify({
      task_type: "cloud_migration",
      strategy_steps: ["run constrained pilot", "validate POPIA controls", "scale after resilience proof"],
      outcome: "success"
    }),
    tags: JSON.stringify(["cloud_migration", "POPIA", "load_shedding"]),
    confidence: 0.84,
    success_rate: 0.82,
    failure_count: 0,
    created_at: "2026-04-20T10:00:00.000Z",
    updated_at: "2026-04-21T10:00:00.000Z"
  });

  const envForSimulation = {
    DB: db,
    AI: aiAlways("[object Object]"),
    SIMULATION_RISK_THRESHOLD: "1.1"
  };
  const digitalTwin = {
    async getLatestTwinState({ organizationId }) {
      return latestTwin(db, organizationId);
    },
    async updateDecisionOutcome({ organizationId, caseState, outcome }) {
      const previous = latestTwin(db, organizationId);
      return {
        ...previous,
        decision_state: {
          ...(previous?.decision_state || {}),
          last_case_id: caseState.case_id,
          last_outcome: outcome
        },
        operational_state: {
          ...(previous?.operational_state || {}),
          last_decision_feedback: { case_id: caseState.case_id, outcome }
        },
        last_updated: new Date().toISOString()
      };
    }
  };
  const loop = new DecisionLoop({
    registryDocument: agentRegistry,
    caseStore: new D1CaseStore(db),
    auditLog: new D1AuditLog(db),
    ai: aiAlways("[object Object]"),
    memoryStore: new D1MemoryStore(db),
    digitalTwin,
    simulation: {
      runSimulation: (state) => runSimulation(state, envForSimulation)
    },
    maxIterations: 16
  });

  const result = await loop.run({
    caseId: "E2E-CLOUD-POPIA",
    userGoal: "Cloud migration with load shedding + POPIA risk",
    maxIterations: 16,
    simulationModeEnabled: true,
    user
  });
  const state = result.case_state;
  const replay = await new D1AuditLog(db).replaySummary("E2E-CLOUD-POPIA");

  assert.equal(result.stop_reason, "decision_reached");
  assert.equal(state.status, "closed");
  assert.ok(state.framework_selection.primary_framework);
  assert.ok(state.framework_selection.secondary_frameworks.length >= 1);
  assert.ok(Object.values(state.framework_outputs).some(Boolean));
  assert.ok(state.blended_analysis.recommended_strategy);
  assert.ok(state.simulation.best_strategy);
  assert.equal(state.simulation.simulation_summary.length, 3);
  assert.ok(state.decision.rationale.includes("Simulation selected"));
  assert.ok(state.digital_twin);
  assert.ok(["medium", "high", "critical"].includes(state.digital_twin.risk_state.level));
  assert.ok(state.narrative.executive_summary);
  assert.ok(state.narrative.strategic_narrative.includes("Situation:"));
  assert.ok(state.narrative.strategic_narrative.includes("Complication:"));
  assert.ok(state.narrative.strategic_narrative.includes("Resolution:"));
  assert.ok(state.narrative.recommended_action);
  assert.ok(db.episodicMemory.length >= 1);
  assert.ok(db.semanticMemory.length >= 1);
  assert.ok(db.organizationMemory.length >= 1);
  assert.ok(db.agentLearningLog.length >= 3);
  assert.ok(replay.events.some((event) => event.event_type === "framework_selected"));
  assert.ok(replay.events.some((event) => event.event_type === "simulation_completed"));
  assert.ok(replay.events.some((event) => event.event_type === "memory_written"));
  assert.ok(replay.events.some((event) => event.event_type === "narrative_generated"));
});
