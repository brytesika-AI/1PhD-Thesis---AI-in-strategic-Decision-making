from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from app.agents.registry import AgentRegistry


ROOT = Path(__file__).resolve().parents[1]


def test_json_registry_matches_cloudflare_pipeline_contract() -> None:
    registry_path = ROOT / "config" / "agents.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    agents = registry["agents"]

    assert list(agents)[:7] == [
        "tracker",
        "induna",
        "auditor",
        "innovator",
        "challenger",
        "architect",
        "guardian",
    ]
    assert {"decision_governor", "consensus_tracker", "policy_sentinel"}.issubset(agents)
    assert agents["tracker"]["handoff_rules"]["next"] == "induna"
    assert agents["guardian"]["handoff_rules"]["next"] is None
    assert agents["challenger"]["requires_human_approval"] is True


def test_python_registry_can_load_cloudflare_json_config() -> None:
    registry = AgentRegistry(ROOT / "config" / "agents.json")

    assert len(registry.agents) == 10
    assert registry.next_agent_id("architect") == "guardian"
    assert registry.get_agent("auditor")["output_schema"] == "AuditorSchema"


def test_cloudflare_worker_artifacts_are_present_and_secret_safe() -> None:
    worker_dir = ROOT / "apps" / "worker"
    wrangler = (worker_dir / "wrangler.toml").read_text(encoding="utf-8")
    legacy_wrangler = (ROOT / "cloudflare-worker" / "wrangler.toml").read_text(encoding="utf-8")
    schema = (worker_dir / "schema.sql").read_text(encoding="utf-8")
    digital_twin = (ROOT / "packages" / "digital-twin" / "digital-twin-engine.js").read_text(encoding="utf-8")
    simulation = (ROOT / "packages" / "simulation" / "simulation-engine.js").read_text(encoding="utf-8")
    selector = (ROOT / "packages" / "frameworks" / "framework-selector.js").read_text(encoding="utf-8")
    blender = (ROOT / "packages" / "frameworks" / "framework-blender.js").read_text(encoding="utf-8")
    narrative = (ROOT / "packages" / "narrative" / "narrative-engine.js").read_text(encoding="utf-8")

    assert 'main = "src/index.js"' in wrangler
    assert 'compatibility_date = "2026-04-22"' in wrangler
    assert "[observability]" in wrangler
    assert "NEWSAPI_KEY" not in legacy_wrangler
    assert "CREATE TABLE IF NOT EXISTS decision_cases" in schema
    assert "CREATE TABLE IF NOT EXISTS audit_events" in schema
    assert "CREATE TABLE IF NOT EXISTS episodic_memory" in schema
    assert "CREATE TABLE IF NOT EXISTS semantic_memory" in schema
    assert "CREATE TABLE IF NOT EXISTS procedural_memory" in schema
    assert "CREATE TABLE IF NOT EXISTS organization_memory" in schema
    assert "CREATE TABLE IF NOT EXISTS agent_learning_log" in schema
    assert "CREATE TABLE IF NOT EXISTS digital_twin_state" in schema
    assert "idx_audit_events_case_time" in schema
    assert "async function updateDigitalTwin" in digital_twin
    assert "fetch_load_shedding_data" in digital_twin
    assert "fetch_market_data" in digital_twin
    assert "fetch_system_metrics" in digital_twin
    assert "fetch_regulatory_updates" in digital_twin
    assert "async function runSimulation" in simulation
    assert "applyScenario" in simulation
    assert "evaluate_outcome" in simulation
    assert "selectFrameworks" in selector
    assert "porters_five_forces" in selector
    assert "scenario_planning" in selector
    assert "blendFrameworks" in blender
    assert "normalizeFrameworkOutputs" in blender
    assert "generateBlendedStrategy" in blender
    assert "generateStrategicNarrative" in narrative
    assert "buildStrategicNarrativePrompt" in narrative
    assert "senior McKinsey partner" in narrative


def test_runtime_config_encodes_gateway_and_sandbox_policy() -> None:
    runtime = json.loads((ROOT / "config" / "runtime.json").read_text(encoding="utf-8"))["runtime"]

    assert runtime["production_target"] == "cloudflare"
    assert runtime["gateway_mode"] == "control_plane"
    assert runtime["engine_mode"] == "stateful_agent_loop"
    assert runtime["ui_mode"] == "visible_workspace"
    assert runtime["routing"]["allow_dynamic_agent_skips"] is False
    assert runtime["sandbox_policy"]["blocked_by_default"] is True
    assert runtime["sandbox_policy"]["allow_shell"] is False
    assert "on_stage_completed" in runtime["event_hooks"]


def test_worker_source_uses_cloudflare_first_bindings() -> None:
    source = (ROOT / "apps" / "worker" / "src" / "index.js").read_text(encoding="utf-8")

    assert "new D1CaseStore(env.DB)" in source
    assert "new D1AuditLog(env.DB)" in source
    assert "ctx.waitUntil" in source
    assert "/api/orchestrate" in source
    assert "/api/loop" in source
    assert "/api/digital-twin" in source
    assert "/api/decision/simulate" in source
    assert "/api/cases" in source
    assert "/events" in source
    assert "updateDigitalTwin(env)" in source
    assert "text/event-stream" in source
    assert "FastAPI" not in source
    assert "uvicorn" not in source
    assert "streamlit" not in source.lower()


def test_cloudflare_pages_workspace_contains_required_panels() -> None:
    html = (ROOT / "apps" / "web" / "index.html").read_text(encoding="utf-8")

    for label in [
        "AI·SRF",
        "STRATEGIC RESILIENCE FRAMEWORK",
        "Risk State",
        "Board Brief",
        "This framework does not help. It governs.",
        "Run full decision cycle",
        "Run Governed Decision Cycle",
        "Challenge assumptions",
        "Re-open case",
        "Evidence",
        "Assumptions",
        "Options",
        "Implementation Roadmap",
        "Audit Trace",
        "Monitoring",
        "Learning & Memory",
        "ORGANIZATIONAL INTELLIGENCE",
        "DIGITAL TWIN STATUS",
        "SIMULATION RESULTS",
        "STRATEGIC ANALYSIS",
        "FRAMEWORK SELECTION",
        "BLENDED STRATEGY",
        "EXECUTIVE NARRATIVE",
        "Run Simulation Before Decision",
        "Strongest Objection",
        "Consensus Level",
        "Implementation Readiness",
        "Challenge function active",
        'const API_BASE = "https://ai-srf-governance-worker.bryte-sika.workers.dev"',
        'console.log("Running decision loop"',
        "strategicAnalysis",
        "frameworkSelection",
        "blendedStrategy",
        "executiveNarrative",
    ]:
        assert label in html


def test_cloudflare_worker_javascript_parses() -> None:
    node = shutil.which("node")
    if not node:
        return

    result = subprocess.run(
        [node, "--check", str(ROOT / "apps" / "worker" / "src" / "index.js")],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr


def test_local_dev_adapters_remain_importable() -> None:
    from app.api.main import app
    from app.ui import main as streamlit_workspace

    assert app.title == "AI-SRF Backend"
    assert streamlit_workspace.BACKEND_URL == "http://localhost:8000"
    assert len(streamlit_workspace.STAGES) == 7
    assert callable(streamlit_workspace.run_stage)
