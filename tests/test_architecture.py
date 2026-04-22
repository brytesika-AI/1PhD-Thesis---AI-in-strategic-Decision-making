from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import uuid4

import pytest

from app.agents.output_schemas import validate_agent_output
from app.agents.registry import AgentRegistry
from app.api.main import decide_approval
from app.api.schemas import ApprovalDecisionRequest
from app.audit.logger import AuditLogger
from app.core.orchestrator import AgentOrchestrator
from app.policy.engine import PolicyEngine
from app.state.models import CaseState
from app.state.store import StateManager


@pytest.fixture
def registry() -> AgentRegistry:
    return AgentRegistry()


@pytest.fixture
def policy(registry: AgentRegistry) -> PolicyEngine:
    return PolicyEngine(registry.agents)


def test_agent_registry_loads_all_ai_srf_agents(registry: AgentRegistry) -> None:
    assert len(registry.agents) == 10
    assert [agent["id"] for agent in registry.list_agents()] == [
        "tracker",
        "induna",
        "auditor",
        "innovator",
        "challenger",
        "architect",
        "guardian",
    ]
    assert registry.get_agent("tracker")["role"] == "Environmental Monitor"
    assert registry.next_agent_id("tracker") == "induna"
    assert registry.get_agent("decision_governor")["role"] == "Orchestration and Control"
    assert registry.get_agent("consensus_tracker")["role"] == "Agreement and Tension State"
    assert registry.get_agent("policy_sentinel")["role"] == "Governance Enforcement"


def test_policy_enforces_allowed_tools_and_blocks_by_default(policy: PolicyEngine) -> None:
    allowed, msg = policy.validate_tool_access("induna", "extract_assumptions")
    assert allowed is True
    assert msg == "Allowed"

    allowed, msg = policy.validate_tool_access("tracker", "build_implementation_plan")
    assert allowed is False
    assert "BLOCKED" in msg

    allowed, msg = policy.validate_tool_access("tracker", "shell")
    assert allowed is False
    assert "globally blocked" in msg

    assert policy.requires_approval("auditor") is True
    assert policy.requires_approval("tracker") is False
    assert policy.safe_handle_upload("board-pack.pdf", b"safe") is True
    assert policy.safe_handle_upload("payload.ps1", b"unsafe") is False


def test_case_state_validation() -> None:
    state = CaseState(case_id="TEST-123", current_stage=2)
    assert state.case_id == "TEST-123"
    assert state.current_stage == 2
    assert isinstance(state.evidence_bundle, dict)
    assert isinstance(state.stage_outputs, dict)


def test_structured_output_validation_preserves_extra_fields() -> None:
    payload = {
        "finding": "Grid instability increases operational risk.",
        "signals": [{"name": "load shedding", "severity": "high"}],
        "tools_used": ["policy_compliance_scan"],
        "custom": "kept",
    }
    validated = validate_agent_output("TrackerSchema", payload)
    assert validated["finding"] == payload["finding"]
    assert validated["signals"] == payload["signals"]
    assert validated["custom"] == "kept"


def workspace_test_dir(name: str) -> Path:
    path = Path("workspace") / "test_runs" / f"{name}-{uuid4().hex}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_audit_logger_creation_and_replay(monkeypatch: pytest.MonkeyPatch) -> None:
    audit_dir = workspace_test_dir("audit")
    monkeypatch.setattr("app.audit.logger.AUDIT_DIR", audit_dir)

    event_id = AuditLogger.log_event(
        case_id="MOCK-CASE",
        agent_id="tracker",
        input_summary="Hello",
        output_summary="World",
        tools_used=[],
        model_used="test-model",
        policy_checks=[],
        human_approval=False,
    )

    events = AuditLogger.replay_case("MOCK-CASE")
    summary = AuditLogger.replay_summary("MOCK-CASE")
    assert len(events) == 1
    assert events[0]["event_id"] == event_id
    assert events[0]["agent_id"] == "tracker"
    assert summary["event_count"] == 1


def test_stage_to_stage_handoff_and_state_persistence(monkeypatch: pytest.MonkeyPatch) -> None:
    async def scenario() -> None:
        run_dir = workspace_test_dir("handoff")
        monkeypatch.setattr("app.state.store.CASES_DIR", run_dir)
        monkeypatch.setattr("app.audit.logger.AUDIT_DIR", run_dir)
        orch = AgentOrchestrator()

        async def mock_complete(*args, **kwargs):
            return """
            {
              "tools_used": ["policy_compliance_scan"],
              "finding": "Mocked environmental finding.",
              "signals": [{"name": "regulatory change", "severity": "medium"}],
              "strategic_tension": "Growth needs stronger governance."
            }
            """

        monkeypatch.setattr(orch.model_client, "complete", mock_complete)

        result = await orch.execute_stage("TEST-CASE", 1, "test user input", "ELEVATED", "Financial")
        saved = StateManager.get_case("TEST-CASE")

        assert result["round"] == 1
        assert result["agent"] == "The Tracker"
        assert result["content"]["finding"] == "Evidence gathered from governed case context."
        assert result["content"]["tool_results"]["gather_evidence"]["finding"] == "Evidence gathered from governed case context."
        assert saved is not None
        assert saved.current_stage == 2
        assert saved.evidence_bundle["signals"][0]["name"] == "strategic_context"
        assert saved.audit_log_refs

    asyncio.run(scenario())


def test_end_to_end_strategic_case_simulation(monkeypatch: pytest.MonkeyPatch) -> None:
    async def scenario() -> None:
        run_dir = workspace_test_dir("e2e")
        monkeypatch.setattr("app.state.store.CASES_DIR", run_dir)
        monkeypatch.setattr("app.audit.logger.AUDIT_DIR", run_dir)
        orch = AgentOrchestrator()

        responses = {
            1: '{"finding":"Briefing complete.","signals":[{"name":"grid","severity":"high"}],"tools_used":["policy_compliance_scan"]}',
            2: '{"finding":"Diagnosis complete.","assumptions":["Board appetite is moderate."],"tools_used":["five_whys"]}',
            3: '{"finding":"Forensic complete.","evidence":{"policy":"King IV"},"compliance_verdict":"review_required","tools_used":["resilience_scoring"]}',
            4: '{"finding":"Options complete.","options":[{"id":"A","name":"Governed rollout"}],"tools_used":["scenario_planning"]}',
            5: '{"finding":"Stress test complete.","stress_tests":[{"option":"A","risk":"Evidence gap"}],"verdict":"modify","tools_used":["swot_analysis"]}',
            6: '{"finding":"Roadmap complete.","implementation_plan":{"track_a":"controls","track_b":"delivery"},"tools_used":["implementation_plan_builder"]}',
            7: '{"finding":"Monitoring active.","monitoring_rules":[{"metric":"decision_alpha","threshold":"monthly"}],"tools_used":["resilience_scoring"]}',
        }

        async def mock_complete(system_prompt, messages, fallback_text):
            stage = orch_stage["value"]
            return responses[stage]

        orch_stage = {"value": 1}
        monkeypatch.setattr(orch.model_client, "complete", mock_complete)

        for stage in range(1, 8):
            orch_stage["value"] = stage
            result = await orch.execute_stage("E2E-CASE", stage, f"stage {stage} input", "ELEVATED", "Financial")
            if result.get("approval_required"):
                gate = result["approval_gate"]
                await decide_approval(
                    "E2E-CASE",
                    gate["approval_id"],
                    ApprovalDecisionRequest(approved=True, reviewer="pytest", notes="Regression approval."),
                )

        state = StateManager.get_case("E2E-CASE")
        replay = AuditLogger.replay_summary("E2E-CASE")

        assert state is not None
        assert state.status == "monitoring"
        assert "Board approval requires auditable evidence" in state.assumptions
        assert state.options_generated[0]["id"] == "opt_1"
        assert state.implementation_plan["phase_1"] == "Confirm controls"
        assert state.monitoring_rules[0]["metric"] == "decision_drift"
        assert replay["event_count"] >= 7
        assert "tracker" in replay["agents"]
        assert all(gate.status == "approved" for gate in state.approval_gates)

    asyncio.run(scenario())


def test_human_approval_blocks_next_stage_until_decided(monkeypatch: pytest.MonkeyPatch) -> None:
    async def scenario() -> None:
        run_dir = workspace_test_dir("approval")
        monkeypatch.setattr("app.state.store.CASES_DIR", run_dir)
        monkeypatch.setattr("app.audit.logger.AUDIT_DIR", run_dir)
        orch = AgentOrchestrator()

        async def mock_complete(*args, **kwargs):
            return '{"finding":"Forensic complete.","tools_used":["resilience_scoring"]}'

        monkeypatch.setattr(orch.model_client, "complete", mock_complete)
        result = await orch.execute_stage("APPROVAL-CASE", 3, "forensic input", "ELEVATED", "Financial")
        assert result["approval_required"] is True
        assert result["approval_gate"]["status"] == "pending"

        blocked = await orch.execute_stage("APPROVAL-CASE", 4, "next input", "ELEVATED", "Financial")
        assert blocked["approval_required"] is True
        assert blocked["error"].startswith("Human approval required")

        await decide_approval(
            "APPROVAL-CASE",
            result["approval_gate"]["approval_id"],
            ApprovalDecisionRequest(approved=True, reviewer="pytest", notes="Proceed."),
        )
        unblocked = await orch.execute_stage("APPROVAL-CASE", 4, "next input", "ELEVATED", "Financial")
        assert unblocked.get("error") is None
        assert unblocked["round"] == 4

    asyncio.run(scenario())
