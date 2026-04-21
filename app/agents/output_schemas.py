from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class AgentOutput(BaseModel):
    """Governed minimum contract shared by all AI-SRF stage outputs."""

    finding: Optional[str] = None
    tools_used: List[str] = Field(default_factory=list)
    handoff_ready: bool = True
    human_review_required: bool = False
    confidence: Optional[float] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class TrackerSchema(AgentOutput):
    signals: List[Dict[str, Any]] = Field(default_factory=list)
    strategic_tension: Optional[str] = None


class IndunaSchema(AgentOutput):
    diagnostic_questions: List[str] = Field(default_factory=list)
    assumptions: List[str] = Field(default_factory=list)


class AuditorSchema(AgentOutput):
    evidence: Dict[str, Any] = Field(default_factory=dict)
    compliance_verdict: Optional[str] = None


class InnovatorSchema(AgentOutput):
    options: List[Dict[str, Any]] = Field(default_factory=list)


class ChallengerSchema(AgentOutput):
    stress_tests: List[Dict[str, Any]] = Field(default_factory=list)
    verdict: Optional[str] = None


class ArchitectSchema(AgentOutput):
    implementation_plan: Dict[str, Any] = Field(default_factory=dict)


class GuardianSchema(AgentOutput):
    monitoring_rules: List[Dict[str, Any]] = Field(default_factory=list)
    system_card: Dict[str, Any] = Field(default_factory=dict)


SCHEMA_REGISTRY = {
    "TrackerSchema": TrackerSchema,
    "IndunaSchema": IndunaSchema,
    "AuditorSchema": AuditorSchema,
    "InnovatorSchema": InnovatorSchema,
    "ChallengerSchema": ChallengerSchema,
    "ArchitectSchema": ArchitectSchema,
    "GuardianSchema": GuardianSchema,
}


def validate_agent_output(schema_name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Validate an agent payload against its declared schema while preserving extra fields."""
    schema = SCHEMA_REGISTRY.get(schema_name, AgentOutput)
    model = schema.model_validate(payload)
    validated = model.model_dump()
    for key, value in payload.items():
        validated.setdefault(key, value)
    return validated
