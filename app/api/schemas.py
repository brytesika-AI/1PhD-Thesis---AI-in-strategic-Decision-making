from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

class Message(BaseModel):
    model_config = {"extra": "ignore"}
    role: str
    content: str

class ConversationRequest(BaseModel):
    messages: List[Message]
    stage: int
    risk_state: str = "ELEVATED"
    sector: str = "generic"
    active_signals: List[Dict[str, Any]] = []
    selected_option_id: Optional[str] = None
    run_id: Optional[str] = None
    scenario_key: Optional[str] = None

class EnvironmentalSignal(BaseModel):
    signal_type: str
    value: str
    severity: str
    timestamp: Optional[str] = None

class RiskStateRequest(BaseModel):
    signals: List[EnvironmentalSignal]


class ApprovalDecisionRequest(BaseModel):
    approved: bool
    reviewer: str = "human_reviewer"
    notes: str = ""
