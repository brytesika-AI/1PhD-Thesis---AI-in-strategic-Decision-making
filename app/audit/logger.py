import json
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

WORKSPACE_DIR = Path(__file__).parent.parent.parent / "workspace"
AUDIT_DIR = WORKSPACE_DIR / "audit_logs"
AUDIT_DIR.mkdir(parents=True, exist_ok=True)


class AuditLogger:
    """Immutable audit logging for compliance and replay."""

    @staticmethod
    def log_event(case_id: str,
                  agent_id: str,
                  input_summary: str,
                  output_summary: str,
                  tools_used: List[str],
                  model_used: str,
                  policy_checks: List[Dict[str, Any]],
                  human_approval: bool = False,
                  raw_payload: Optional[Dict[str, Any]] = None,
                  event_type: str = "agent_execution") -> str:

        log_file = AUDIT_DIR / f"{case_id}_audit.jsonl"
        event_id = str(uuid4())
        event = {
            "event_id": event_id,
            "event_type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "case_id": case_id,
            "agent_id": agent_id,
            "input_summary": input_summary,
            "output_summary": output_summary,
            "tools_used": tools_used,
            "model_used": model_used,
            "policy_checks": policy_checks,
            "human_approval": human_approval,
            "raw_payload": raw_payload or {}
        }

        with open(log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(event) + "\n")
        return event_id

    @staticmethod
    def replay_case(case_id: str) -> List[Dict[str, Any]]:
        """Reads JSONL and returns the sequential event history."""
        log_file = AUDIT_DIR / f"{case_id}_audit.jsonl"
        if not log_file.exists():
            return []

        events = []
        with open(log_file, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    events.append(json.loads(line))
        return events

    @staticmethod
    def replay_summary(case_id: str) -> Dict[str, Any]:
        """Build a compact replay object for UI and API consumers."""
        events = AuditLogger.replay_case(case_id)
        return {
            "case_id": case_id,
            "event_count": len(events),
            "agents": [event.get("agent_id") for event in events],
            "tools_used": sorted({tool for event in events for tool in event.get("tools_used", [])}),
            "events": events,
        }
