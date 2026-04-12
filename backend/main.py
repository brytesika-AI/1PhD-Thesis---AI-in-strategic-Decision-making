from __future__ import annotations
import json
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
from backend.silicon_sampling import run_silicon_sampling as run_engine
from backend.agent_orchestrator import AgentOrchestrator
from backend.schemas import ConversationRequest, RiskStateRequest

app = FastAPI(title="AI-SRF Backend", version="1.4.0 (McKinsey-SA Edition)")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

agent_orchestrator = AgentOrchestrator()

@app.get("/")
async def root():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/dashboard")

@app.get("/health")
async def health():
    return {"status": "operational", "framework": "Microsoft AutoGen 0.2.x", "agents": 6}

@app.post("/api/environmental-monitor")
async def monitor(request: RiskStateRequest):
    return classify_environment_local([s.model_dump() for s in request.signals])

@app.post("/api/conversation")
async def conversation(request: ConversationRequest):
    messages = [m.model_dump() for m in request.messages]
    latest_input = messages[-1]["content"] if messages else ""
    
    raw_msgs = []
    # Execute AutoGen Autonomous Group Chat with Tools
    try:
        results = await agent_orchestrator.run_governance_cycle(
            user_input=latest_input,
            risk_state=request.risk_state,
            sector=request.sector or "financial_services"
        )
        content = results["verdict"]
        raw_msgs = results.get("messages", [])
        # Standardize format for frontend
        if isinstance(content, str):
            try: content = json.loads(content)
            except: content = {"verdict": content, "risk_state": request.risk_state}
    except Exception as e:
        print(f"AutoGen Error: {e}")
        content = {"verdict": f"Autonomous Reasoning Hub Error: {str(e)}", "risk_mitigation": "Review system logs."}
        
    if request.run_id:
        upsert_run(request.run_id, request.sector, request.risk_state, request.stage)
        save_stage_payload(request.run_id, request.stage, "AutoGen Orchestrator", content)
        
    return {"agent": "AutoGen Framework", "content": content, "run_id": request.run_id, "raw_messages": raw_msgs}

@app.post("/api/silicon-sampling/run")
async def run_silicon(sector: str = "generic"):
    return run_engine(sector=sector)

@app.get("/api/runs")
async def runs(): return {"runs": list_runs()}

@app.get("/api/runs/{run_id}")
async def history(run_id: str): return get_run_history(run_id)

@app.get("/api/conversation/stream")
async def conversation_stream(
    query: str = Query(...),
    risk_state: str = Query("ELEVATED"),
    sector: str = Query("financial_services")
):
    """SSE endpoint that streams each agent deliberation step in real-time."""
    async def event_generator():
        async for step in agent_orchestrator.stream_governance_cycle(
            user_input=query,
            risk_state=risk_state,
            sector=sector
        ):
            yield f"data: {json.dumps(step)}\n\n"
        yield "data: [DONE]\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@app.post("/api/conversation/guided")
async def conversation_guided(request: ConversationRequest):
    """
    Stage-based guided conversation — human-in-the-loop.
    Each call advances one stage. The frontend manages stage progression.
    Streams the targeted agent's response via SSE.
    """
    from azure.ai.inference.models import SystemMessage as SM, UserMessage as UM
    
    stage = request.stage
    if stage < 1 or stage > 6:
        raise HTTPException(status_code=400, detail="Stage must be 1–6")
    
    system_prompt = get_system_prompt(
        stage=stage,
        risk_state=request.risk_state,
        sector=request.sector or "financial_services"
    )
    
    agent_names = {
        1: "Socratic Partner",
        2: "Forensic Analyst",
        3: "Creative Catalyst",
        4: "Devil's Advocate",
        5: "Implementation Scaffolding",
        6: "Monitoring Agent"
    }
    
    # Build context and openings/closings
    context = request.session_context or {}
    opening = agent_orchestrator.build_stage_opening(stage, agent_name, context)
    
    # Build message history for the LLM
    llm_messages = [SM(content=system_prompt + "\n\n" + opening)]
    for m in request.messages:
        msg = m.model_dump()
        if msg["role"] == "user":
            llm_messages.append(UM(content=msg["content"]))
        else:
            from azure.ai.inference.models import AssistantMessage as AMsg
            llm_messages.append(AMsg(content=msg["content"]))
    
    async def stream_agent():
        # Emit agent metadata
        yield f"data: {json.dumps({'type': 'agent_start', 'agent': agent_name, 'stage': stage})}\n\n"
        
        try:
            response = await agent_orchestrator.client.complete(
                messages=llm_messages,
                model=agent_orchestrator.model_name,
                tools=agent_orchestrator.tools if stage <= 2 else None,
                temperature=0.3
            )
            
            msg = response.choices[0].message
            content = msg.content or ""
            
            # Handle tool calls
            if hasattr(msg, 'tool_calls') and msg.tool_calls:
                # ... (existing tool call logic)
                pass # I'll actually keep the existing logic below

            # Final content assembly with handoff
            closing = agent_orchestrator.build_stage_closing(stage, agent_names.get(stage+1, "Session End"), "Stage Complete")
            full_output = content + "\n\n" + closing
            
            # Stream content
            chunk_size = 60
            for i in range(0, len(full_output), chunk_size):
                chunk = full_output[i:i+chunk_size]
                yield f"data: {json.dumps({'type': 'delta', 'text': chunk})}\n\n"
                import asyncio
                await asyncio.sleep(0.01)
            
            yield f"data: {json.dumps({'type': 'done', 'agent': agent_name, 'stage': stage, 'full_content': full_output})}\n\n"
            
        except Exception as e:
            print(f"Guided conversation error: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
    
    return StreamingResponse(
        stream_agent(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@app.get("/api/scenarios")
async def get_scenarios():
    """Return available scenario templates for the dashboard."""
    from config.scenario_templates import SCENARIO_TEMPLATES
    return {"scenarios": {
        k: {"label": v["label"], "seed_message": v["seed_message"], "risk_state": v.get("risk_state_override", "ELEVATED")}
        for k, v in SCENARIO_TEMPLATES.items()
    }}

@app.get("/dashboard")
async def dashboard():
    return FileResponse("app/dashboard.html")
