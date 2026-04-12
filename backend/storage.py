import json
import os
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Any

RUNS_DIR = Path(__file__).parent.parent / "workspace" / "runs"
RUNS_DIR.mkdir(parents=True, exist_ok=True)

def upsert_run(run_id: str, sector: str, risk_state: str, stage: int, scenario_key: str = None):
    run_file = RUNS_DIR / f"{run_id}.json"
    data = {"run_id": run_id, "sector": sector, "risk_state": risk_state, "current_stage": stage, "scenario_key": scenario_key, "updated_at": datetime.now(timezone.utc).isoformat()}
    
    if run_file.exists():
        with open(run_file, "r") as f:
            try:
                existing_data = json.load(f)
            except json.JSONDecodeError:
                existing_data = {}
                
        # Merge by updating the existing data with the NEW data
        existing_data.update({k: v for k, v in data.items() if v is not None})
        existing_data["current_stage"] = max(existing_data.get("current_stage", 0), stage)
        data = existing_data
        
    with open(run_file, "w") as f:
        json.dump(data, f, indent=2)

def save_stage_payload(run_id: str, stage: int, agent: str, payload: Dict[str, Any]):
    trace_dir = RUNS_DIR / run_id / "traces"
    trace_dir.mkdir(parents=True, exist_ok=True)
    filename = f"stage_{stage}_{agent.lower().replace(' ', '_')}.json"
    with open(trace_dir / filename, "w") as f:
        json.dump({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "stage": stage,
            "agent": agent,
            "payload": payload
        }, f, indent=2)

def list_runs(limit: int = 20):
    files = sorted(RUNS_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True)
    runs = []
    for f in files[:limit]:
        with open(f, "r") as r:
            runs.append(json.load(r))
    return runs

def get_run_history(run_id: str):
    trace_dir = RUNS_DIR / run_id / "traces"
    if not trace_dir.exists(): return []
    history = []
    for f in sorted(trace_dir.glob("*.json")):
        with open(f, "r") as r:
            history.append(json.load(r))
    return history
