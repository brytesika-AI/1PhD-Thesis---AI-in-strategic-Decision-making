from __future__ import annotations
import json
import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, Response, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse, FileResponse
from backend.model_client import ModelClient
from backend.rag_engine import RAGEngine
from backend.prompt_templates import get_system_prompt
from backend.stage_engine import classify_environment_local, fallback_stage_output
from backend.storage import get_run_history, list_runs, save_stage_payload, upsert_run
from backend.agent_orchestrator import AgentOrchestrator
from backend.schemas import ConversationRequest, RiskStateRequest
from backend.calculations.ror_engine import RORState, extract_financials_from_input

app = FastAPI(title="AI-SRF Backend", version="4.0.0 (Doctoral Edition)")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

agent_orchestrator = AgentOrchestrator()

@app.get("/")
async def root():
    return {"status": "operational", "version": "4.0.0", "framework": "AI-SRF Doctoral Architecture"}

@app.post("/api/conversation")
async def conversation(request: ConversationRequest):
    """
    Synchronous (buffered) conversation endpoint for Stage-by-Stage execution.
    Supports the V4.0 Doctoral Architecture (7 Stages).
    """
    messages = [m.model_dump() for m in request.messages]
    latest_input = messages[-1]["content"] if messages else ""
    
    # Initialize ROR State for this session
    ror_state = RORState()
    # If the request contains session context, we might want to restore ROR state
    # For now, we extract from the latest input to keep it live
    extracted = extract_financials_from_input(latest_input)
    if 'investment_total' in extracted: ror_state.investment_total = extracted['investment_total']
    if 'current_recovery_pct' in extracted: ror_state.current_recovery_pct = extracted['current_recovery_pct']

    steps = []
    final_verdict = {}
    system_card = None
    env_brief = {}

    try:
        # Run the cycle for the specific stage requested by the frontend
        # In V4, the frontend calls this per stage (st.session_state.stage)
        stage = request.stage or 1
        
        async for step in agent_orchestrator.stream_governance_cycle(
            user_input=latest_input,
            risk_state=request.risk_state,
            sector=request.sector or "financial_services",
            ror_state=ror_state
        ):
            # We filter for the current stage or global events
            if step["round"] == stage or step["round"] == 0:
                steps.append(step)
                if step["step"] == "analysis":
                    final_verdict = step["content"]
                if step["step"] == "sensing":
                    # We'll actually get the real brief in the next step
                    pass
                if step["step"] == "audit":
                    system_card = step["content"]
        
        # Capture environmental brief from orchestrator session
        # (This is a bit complex in a stateless API, usually we'd pass it back)
        from backend.apis.sa_sensing import get_full_environmental_brief
        env_brief = await get_full_environmental_brief(request.sector or "financial_services")

    except Exception as e:
        print(f"V4 Orchestrator Error: {e}")
        final_verdict = {"error": str(e), "verdict": "Internal Reasoning Failure"}

    return {
        "agent": "AI-SRF Framework V4.0",
        "content": final_verdict,
        "raw": json.dumps(final_verdict, indent=2) if isinstance(final_verdict, dict) else str(final_verdict),
        "env_brief": env_brief,
        "system_card": system_card,
        "run_id": request.run_id
    }

@app.get("/api/runs")
async def runs(): return {"runs": list_runs()}

@app.get("/api/runs/{run_id}")
async def history(run_id: str): return get_run_history(run_id)

@app.get("/dashboard")
async def dashboard():
    return FileResponse("app/dashboard.html")
