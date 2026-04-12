import os
import json
import asyncio
from typing import Dict, List, Optional
from datetime import datetime
from backend.model_client import ModelClient
from backend.rag_engine import RAGEngine
from backend.prompt_templates import get_system_prompt
from azure.ai.inference.models import SystemMessage, UserMessage, AssistantMessage
from azure.core.credentials import AzureKeyCredential
from azure.ai.inference.aio import ChatCompletionsClient

from backend.calculations.ror_engine import RORState, extract_financials_from_input
from backend.apis.sa_sensing import get_full_environmental_brief

class AgentOrchestrator:
    """
    AI-SRF Stage Transition & JSON Validation Engine.
    Implements the 7-stage sovereign reasoning cycle.
    (Sikazwe, 2026)
    """

    def __init__(self):
        self.model_client = ModelClient()
        self.rag_engine = RAGEngine()
        
        status = self.model_client.provider_status()
        self.model_name = status["model"]
        
        if status["provider"] == "ollama":
            self.base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
            self.api_key = "ollama"
        elif status["provider"] == "github_models":
            self.base_url = "https://models.inference.ai.azure.com"
            self.api_key = os.getenv("GITHUB_MODELS_API_KEY", "")
        else:
            self.base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
            self.api_key = os.getenv("OPENAI_API_KEY", "")
            
        self.client = ChatCompletionsClient(
            endpoint=self.base_url,
            credential=AzureKeyCredential(self.api_key),
            api_version="2024-02-15-preview"
        )

    def _parse_json_safely(self, text: str) -> dict:
        """Extract and parse JSON from agent output."""
        try:
            # Look for JSON block if model includes prose
            json_match = re.search(r'(\{.*\}|\[.*\])', text, re.DOTALL)
            if json_match:
                return json.loads(json_match.group(1))
            return json.loads(text)
        except Exception as e:
            print(f"JSON Parse Error: {e} | Text: {text[:100]}...")
            return {"error": "Invalid JSON output", "raw": text}

    async def stream_governance_cycle(self, user_input: str, risk_state: str, sector: str, ror_state: RORState):
        """
        Executes the 7-stage Doctoral Architecture cycle.
        (Sikazwe, 2026)
        """
        session_context = {}
        history = [UserMessage(content=user_input)]
        
        agent_map = {
            1: "The Tracker",
            2: "The Induna",
            3: "The Auditor",
            4: "The Innovator",
            5: "The Challenger",
            6: "The Architect",
            7: "The Guardian"
        }

        # STAGE 0: Initial Sensing
        yield {"round": 0, "step": "sensing", "agent": "Intelligence Core", "content": "Initializing SA Environmental Brief..."}
        env_brief = await get_full_environmental_brief(sector)
        session_context["env_brief"] = env_brief
        
        for stage_id in range(1, 8):
            agent_name = agent_map[stage_id]
            yield {"round": stage_id, "step": "router", "agent": "Orchestrator", "content": f"Invoking Stage {stage_id}: {agent_name}"}
            
            # Build injected context
            injected_context = f"CURRENT ROR STATE: {ror_state.format_full_ror_block()}\n"
            if stage_id == 1:
                injected_context += f"ENVIRONMENTAL DATA: {json.dumps(env_brief)}\n"
            
            system_prompt = get_system_prompt(stage_id, risk_state, sector, injected_context)
            messages = [SystemMessage(content=system_prompt)] + history
            
            try:
                response = await self.client.complete(
                    messages=messages,
                    model=self.model_name,
                    temperature=0.2
                )
                
                raw_content = response.choices[0].message.content or ""
                parsed_json = self._parse_json_safely(raw_content)
                history.append(AssistantMessage(content=raw_content))
                
                # Update Session Context based on JSON
                if "digital_gauntlet" in parsed_json:
                    ror_state.gauntlet_conditions_passed = parsed_json["digital_gauntlet"].get("score", ror_state.gauntlet_conditions_passed)
                
                yield {
                    "round": stage_id,
                    "step": "analysis",
                    "agent": agent_name,
                    "content": parsed_json,
                    "raw": raw_content
                }
                
                # Stage 7 Audit trail: Generate System Card
                if stage_id == 7:
                    system_card = self.rag_engine.generate_ai_system_card("SESSION-UUID", "COMPLIANT", list(agent_map.values()))
                    yield {"round": 7, "step": "audit", "agent": "Guardian", "content": system_card}

            except Exception as e:
                yield {"round": stage_id, "step": "error", "agent": agent_name, "content": f"Execution Failure: {str(e)}"}
                break

import re
