from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ApprovalGate(BaseModel):
    """Human approval record for a governed stage transition."""

    approval_id: str
    stage_id: int
    agent_id: str
    status: str = "pending"
    requested_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    decided_at: Optional[str] = None
    reviewer: Optional[str] = None
    notes: str = ""
    audit_ref: Optional[str] = None


class CaseState(BaseModel):
    case_id: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    current_stage: int = 1
    status: str = "active"
    user_goal: str = ""
    evidence_bundle: Dict[str, Any] = Field(default_factory=dict)
    assumptions: List[str] = Field(default_factory=list)
    options_generated: List[Dict[str, Any]] = Field(default_factory=list)
    devil_advocate_findings: Dict[str, Any] = Field(default_factory=dict)
    implementation_plan: Dict[str, Any] = Field(default_factory=dict)
    monitoring_rules: List[Dict[str, Any]] = Field(default_factory=list)
    audit_log_refs: List[str] = Field(default_factory=list)
    stage_outputs: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    approval_gates: List[ApprovalGate] = Field(default_factory=list)


class EnvironmentalSignal(BaseModel):
    signal_type: str
    value: str
    severity: str
    timestamp: Optional[str] = None

