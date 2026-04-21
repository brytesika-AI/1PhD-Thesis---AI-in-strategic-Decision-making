from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.core.orchestrator import AgentOrchestrator
from app.api.schemas import ApprovalDecisionRequest, ConversationRequest
from app.state.store import StateManager
from app.audit.logger import AuditLogger

app = FastAPI(title="AI-SRF Backend", version="4.0.0 (Doctoral Edition)")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

orchestrator = AgentOrchestrator()

@app.get("/")
async def root():
    return {"status": "operational", "version": "4.0.0", "framework": "AI-SRF Enterprise"}

@app.get("/health")
async def health():
    return {
        "status": "operational",
        "version": "4.0.0",
        "model": orchestrator.model_client.provider_status(),
        "agents": len(orchestrator.registry.agents),
    }

@app.post("/api/conversation")
async def conversation(request: ConversationRequest):
    """Execute a single stage iteration using the orchestrator."""
    messages = [m.model_dump() for m in request.messages]
    latest_input = messages[-1]["content"] if messages else ""
    
    stage = request.stage or 1
    run_id = request.run_id or "default_case"
    sector = request.sector or "financial_services"
    risk_state = request.risk_state or "ELEVATED"
    
    try:
        result = await orchestrator.execute_stage(
            case_id=run_id,
            stage_id=stage,
            user_input=latest_input,
            risk_state=risk_state,
            sector=sector
        )
        if result.get("error"):
            return {**result, "run_id": run_id}
        return {
            "agent": result.get("agent"),
            "content": result.get("content"),
            "raw": result.get("raw"),
            "run_id": run_id,
            "case_state": result.get("case_state"),
            "approval_required": result.get("approval_required", False),
            "approval_gate": result.get("approval_gate"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/runs")
async def runs():
    cases = StateManager.list_cases()
    return {"runs": [c.model_dump() for c in cases]}

@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    case = StateManager.get_case(run_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return {"case": case.model_dump()}

@app.get("/api/runs/{run_id}/audit")
async def get_audit(run_id: str):
    return {"audit": AuditLogger.replay_case(run_id)}

@app.get("/api/runs/{run_id}/replay")
async def replay_run(run_id: str):
    case = StateManager.get_case(run_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return {"case": case.model_dump(), "replay": AuditLogger.replay_summary(run_id)}

@app.get("/api/agents")
async def agents():
    return {"agents": orchestrator.registry.list_agents()}

@app.post("/api/runs/{run_id}/approvals/{approval_id}")
async def decide_approval(run_id: str, approval_id: str, request: ApprovalDecisionRequest):
    case = StateManager.get_case(run_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    gate = next((item for item in case.approval_gates if item.approval_id == approval_id), None)
    if not gate:
        raise HTTPException(status_code=404, detail="Approval gate not found")
    if gate.status != "pending":
        raise HTTPException(status_code=409, detail=f"Approval gate already {gate.status}")

    gate.status = "approved" if request.approved else "rejected"
    gate.reviewer = request.reviewer
    gate.notes = request.notes
    gate.decided_at = datetime.now(timezone.utc).isoformat()

    if request.approved:
        case.status = "active"
        case.current_stage = min(gate.stage_id + 1, 7)
        event_type = "human_approval_approved"
        summary = f"Stage {gate.stage_id} approved by {request.reviewer}"
    else:
        case.status = "revision_required"
        case.current_stage = gate.stage_id
        event_type = "human_approval_rejected"
        summary = f"Stage {gate.stage_id} rejected by {request.reviewer}"

    audit_ref = AuditLogger.log_event(
        case_id=run_id,
        agent_id=gate.agent_id,
        input_summary=f"Approval decision for {approval_id}",
        output_summary=summary,
        tools_used=[],
        model_used="human-review",
        policy_checks=[{"approval_id": approval_id, "decision": gate.status, "allowed": True}],
        human_approval=True,
        raw_payload=gate.model_dump(),
        event_type=event_type,
    )
    case.audit_log_refs.append(audit_ref)
    StateManager.save_case(case)
    return {"case": case.model_dump(), "approval_gate": gate.model_dump(), "audit_ref": audit_ref}
