import os
import json
from typing import Dict, List, Optional
from duckduckgo_search import DDGS
from backend.model_client import ModelClient
from backend.rag_engine import RAGEngine
from backend.prompt_templates import get_system_prompt

from azure.ai.inference.aio import ChatCompletionsClient
from azure.ai.inference.models import SystemMessage, UserMessage, AssistantMessage, ToolMessage, ChatCompletionsToolDefinition, FunctionDefinition, ChatCompletionsToolCall
from azure.core.credentials import AzureKeyCredential

from backend.calculations.ror_engine import RORState, extract_financials_from_input

class AgentOrchestrator:
    @staticmethod
    def build_stage_opening(stage_number: int, agent_name: str, session_context: dict) -> str:
        """Opens stage by acknowledging prior confirmations."""
        ctx = session_context
        prior_stage = stage_number - 1
        if prior_stage <= 0: return ""
        
        prior_findings = ctx.get('confirmed_findings', [])
        chosen_option = ctx.get('chosen_option', None)
        board_deadline = ctx.get('executive_constraints', {}).get('board_deadline', None)
        investment = ctx.get('financial_data', {}).get('investment_total', None)

        opening = f"\n## STAGE {stage_number} — {agent_name.upper()}\n\n**Inheriting from Stage {prior_stage}:**\n"
        if prior_findings:
            for f in prior_findings[-3:]: opening += f"— {f}\n"
        if chosen_option: opening += f"— Executive selected: {chosen_option}\n"
        if board_deadline: opening += f"— Board deadline: {board_deadline}\n"
        if investment: opening += f"— Capital at risk: R{investment}M (current recovery: ~20%)\n"
        return opening + "\n"

    @staticmethod
    def build_stage_closing(stage_number: int, next_agent_name: str, key_output: str) -> str:
        """Closes stage with a crisp handoff."""
        if stage_number == 6:
            return f"\n---\n## SESSION CONCLUSION\n\n{key_output}\n\n**This strategic session is complete.**\nReference: (Sikazwe, 2026)\n"
        
        verbs = {1: "Diagnostic complete. Proceeding to", 2: "Forensic analysis complete. Proceeding to", 
                 3: "Strategic options presented. Proceeding to", 4: "Stress test complete. Proceeding to", 
                 5: "Implementation scaffolding complete. Proceeding to", 6: "Monitoring established."}
        verb = verbs.get(stage_number, "Proceeding to")
        return f"\n---\n**{verb} {next_agent_name}.**\n\n*Passing forward: {key_output}*\n---\n"

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
        
        # Define Tools
        self.tools = [
            ChatCompletionsToolDefinition(
                function=FunctionDefinition(
                    name="web_search",
                    description="Search the web for real-time market/policy signals.",
                    parameters={
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "The search query"}
                        },
                        "required": ["query"]
                    }
                )
            ),
            ChatCompletionsToolDefinition(
                function=FunctionDefinition(
                    name="rag_search",
                    description="Query the internal RAG engine for POPIA/KING IV regulations.",
                    parameters={
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "The search query"}
                        },
                        "required": ["query"]
                    }
                )
            )
        ]

    def _execute_tool(self, tool_call: ChatCompletionsToolCall) -> str:
        name = tool_call.function.name
        try:
            args = json.loads(tool_call.function.arguments)
        except:
            args = {}
            
        if name == "web_search":
            query = args.get("query", "")
            with DDGS() as ddgs:
                results = [r['body'] for r in ddgs.text(query, max_results=3)]
                return "\n".join(results) if results else "No results found."
                
        elif name == "rag_search":
            query = args.get("query", "")
            results = self.rag_engine.retrieve(query)
            return "\n".join([r['text'] for r in results]) if results else "No documents matched."
            
        return f"Tool {name} not found."

    async def run_governance_cycle(self, user_input: str, risk_state: str, sector: str):
        # Master Log of all messages
        conversation_log = [UserMessage(content=user_input)]
        
        # Structured trace for transparency
        trace = []
        
        # Dynamic Router loop
        max_rounds = 7
        current_round = 0
        
        # Names based on prompt_templates
        agent_names = {
            1: "Environmental Monitor",
            2: "Socratic Partner",
            3: "Forensic Analyst",
            4: "Creative Catalyst",
            5: "Devil's Advocate"
        }
        
        verdict = ""
        
        trace.append({
            "round": 0,
            "step": "input",
            "agent": "User",
            "content": user_input,
            "tools": []
        })
        
        while current_round < max_rounds:
            current_round += 1
            
            # ROUTER: Decide who speaks next
            router_prompt = (
                f"You are the Dynamic Router for the SRF Governance process. The current risk state is {risk_state} for {sector}.\n"
                "Review the conversation history and decide which agent should speak next.\n"
                "Available agents:\n"
                "1. Environmental_Monitor (checks market/news signals)\n"
                "2. Socratic_Partner (questions assumptions)\n"
                "3. Forensic_Analyst (checks regulations like POPIA/KING IV)\n"
                "4. Creative_Catalyst (suggests unconventional alternatives)\n"
                "5. Devils_Advocate (highlights worst-case scenarios and finalize verdict)\n"
                "You MUST reply ONLY with a single digit (1, 2, 3, 4, or 5) representing the next agent. "
                "Do NOT include any other text, reasoning, punctuation, or markdown. Just one number.\n"
                "If Devil's Advocate has already spoken and a strategic conclusion is reached, reply with exactly 'DONE'."
            )
            
            router_messages = [SystemMessage(content=router_prompt)] + conversation_log
            
            try:
                router_res = await self.client.complete(
                    messages=router_messages,
                    model=self.model_name,
                    temperature=0.1
                )
                router_decision = router_res.choices[0].message.content.strip().upper()
                print(f"[ROUND {current_round}] ROUTER DECISION: '{router_decision}'")
                
                if "DONE" in router_decision or current_round == max_rounds:
                    trace.append({
                        "round": current_round,
                        "step": "router",
                        "agent": "Dynamic Router",
                        "content": f"Decision: DONE — Governance cycle concluded after {current_round - 1} agent rounds.",
                        "tools": []
                    })
                    break
                    
                agent_id = next((k for k in agent_names.keys() if str(k) in router_decision), 5)
                
                trace.append({
                    "round": current_round,
                    "step": "router",
                    "agent": "Dynamic Router",
                    "content": f"Routing to: {agent_names[agent_id]} (Agent #{agent_id})",
                    "tools": []
                })
                
            except Exception as e:
                print(f"Router Error: {e}")
                agent_id = 5
                trace.append({
                    "round": current_round,
                    "step": "router",
                    "agent": "Dynamic Router",
                    "content": f"Router error — defaulting to Devil's Advocate. Error: {str(e)}",
                    "tools": []
                })

            agent_name = agent_names[agent_id]
            print(f"[ROUND {current_round}] INVOKING AGENT: {agent_name} (ID: {agent_id})")
            system_msg = get_system_prompt(agent_id, risk_state, sector)
            
            # AGENT EXECUTION
            agent_messages = [SystemMessage(content=system_msg)] + conversation_log
            
            response = await self.client.complete(
                messages=agent_messages,
                model=self.model_name,
                tools=self.tools,
                temperature=0.2
            )
            
            msg = response.choices[0].message
            conversation_log.append(msg)
            
            # Handle Tool Calls
            tool_entries = []
            if hasattr(msg, 'tool_calls') and msg.tool_calls:
                for tool_call in msg.tool_calls:
                    tool_name = tool_call.function.name
                    print(f"[TOOL CALL] {agent_name} called {tool_name}")
                    tool_result = self._execute_tool(tool_call)
                    conversation_log.append(ToolMessage(
                        tool_call_id=tool_call.id,
                        content=tool_result
                    ))
                    tool_entries.append({
                        "tool": tool_name,
                        "query": tool_call.function.arguments,
                        "result_preview": tool_result[:300] if tool_result else "No results"
                    })
                
                # Record agent's initial tool call step
                trace.append({
                    "round": current_round,
                    "step": "tool_call",
                    "agent": agent_name,
                    "content": f"{agent_name} invoked {len(tool_entries)} tool(s) to gather evidence.",
                    "tools": tool_entries
                })
                    
                agent_messages = [SystemMessage(content=system_msg)] + conversation_log
                follow_up = await self.client.complete(
                    messages=agent_messages,
                    model=self.model_name,
                    tools=self.tools,
                    temperature=0.2
                )
                msg2 = follow_up.choices[0].message
                conversation_log.append(msg2)
                verdict = msg2.content or ""
                
                trace.append({
                    "round": current_round,
                    "step": "analysis",
                    "agent": agent_name,
                    "content": verdict,
                    "tools": []
                })
            else:
                verdict = msg.content or ""
                trace.append({
                    "round": current_round,
                    "step": "analysis",
                    "agent": agent_name,
                    "content": verdict,
                    "tools": []
                })
                
            print(f"[{agent_name}] CONTENT PREVIEW: {verdict[:100]}...")
            
            if agent_id == 5:
                break
                
        return {
            "messages": trace,
            "verdict": verdict if verdict else "No verdict reached."
        }

    async def stream_governance_cycle(self, user_input: str, risk_state: str, sector: str):
        """Async generator that yields each deliberation step as it happens."""
        conversation_log = [UserMessage(content=user_input)]
        max_rounds = 7
        current_round = 0
        
        agent_names = {
            1: "Environmental Monitor",
            2: "Socratic Partner",
            3: "Forensic Analyst",
            4: "Creative Catalyst",
            5: "Devil's Advocate"
        }
        
        verdict = ""
        
        yield {
            "round": 0, "step": "input", "agent": "User",
            "content": user_input, "tools": []
        }
        
        while current_round < max_rounds:
            current_round += 1
            
            router_prompt = (
                f"You are the Dynamic Router for the SRF Governance process. The current risk state is {risk_state} for {sector}.\n"
                "Review the conversation history and decide which agent should speak next.\n"
                "Available agents:\n"
                "1. Environmental_Monitor (checks market/news signals)\n"
                "2. Socratic_Partner (questions assumptions)\n"
                "3. Forensic_Analyst (checks regulations like POPIA/KING IV)\n"
                "4. Creative_Catalyst (suggests unconventional alternatives)\n"
                "5. Devils_Advocate (highlights worst-case scenarios and finalize verdict)\n"
                "You MUST reply ONLY with a single digit (1, 2, 3, 4, or 5) representing the next agent. "
                "Do NOT include any other text, reasoning, punctuation, or markdown. Just one number.\n"
                "If Devil's Advocate has already spoken and a strategic conclusion is reached, reply with exactly 'DONE'."
            )
            
            router_messages = [SystemMessage(content=router_prompt)] + conversation_log
            
            try:
                router_res = await self.client.complete(
                    messages=router_messages,
                    model=self.model_name,
                    temperature=0.1
                )
                router_decision = router_res.choices[0].message.content.strip().upper()
                print(f"[STREAM ROUND {current_round}] ROUTER: '{router_decision}'")
                
                if "DONE" in router_decision or current_round == max_rounds:
                    yield {
                        "round": current_round, "step": "router", "agent": "Dynamic Router",
                        "content": f"Decision: DONE — Governance cycle concluded after {current_round - 1} agent rounds.",
                        "tools": []
                    }
                    break
                    
                agent_id = next((k for k in agent_names.keys() if str(k) in router_decision), 5)
                
                yield {
                    "round": current_round, "step": "router", "agent": "Dynamic Router",
                    "content": f"Routing to: {agent_names[agent_id]} (Agent #{agent_id})",
                    "tools": []
                }
                
            except Exception as e:
                print(f"Router Error: {e}")
                agent_id = 5
                yield {
                    "round": current_round, "step": "router", "agent": "Dynamic Router",
                    "content": f"Router error — defaulting to Devil's Advocate.",
                    "tools": []
                }

            agent_name = agent_names[agent_id]
            system_msg = get_system_prompt(agent_id, risk_state, sector)
            agent_messages = [SystemMessage(content=system_msg)] + conversation_log
            
            response = await self.client.complete(
                messages=agent_messages,
                model=self.model_name,
                tools=self.tools,
                temperature=0.2
            )
            
            msg = response.choices[0].message
            conversation_log.append(msg)
            
            tool_entries = []
            if hasattr(msg, 'tool_calls') and msg.tool_calls:
                for tool_call in msg.tool_calls:
                    tool_name = tool_call.function.name
                    tool_result = self._execute_tool(tool_call)
                    conversation_log.append(ToolMessage(
                        tool_call_id=tool_call.id,
                        content=tool_result
                    ))
                    tool_entries.append({
                        "tool": tool_name,
                        "query": tool_call.function.arguments,
                        "result_preview": tool_result[:300] if tool_result else "No results"
                    })
                
                yield {
                    "round": current_round, "step": "tool_call", "agent": agent_name,
                    "content": f"{agent_name} invoked {len(tool_entries)} tool(s) to gather evidence.",
                    "tools": tool_entries
                }
                    
                agent_messages = [SystemMessage(content=system_msg)] + conversation_log
                follow_up = await self.client.complete(
                    messages=agent_messages,
                    model=self.model_name,
                    tools=self.tools,
                    temperature=0.2
                )
                msg2 = follow_up.choices[0].message
                conversation_log.append(msg2)
                verdict = msg2.content or ""
                
                yield {
                    "round": current_round, "step": "analysis", "agent": agent_name,
                    "content": verdict, "tools": []
                }
            else:
                verdict = msg.content or ""
                yield {
                    "round": current_round, "step": "analysis", "agent": agent_name,
                    "content": verdict, "tools": []
                }
            
            if agent_id == 5:
                break
        
        yield {
            "round": current_round, "step": "verdict", "agent": "Governance Framework",
            "content": verdict if verdict else "No verdict reached.", "tools": []
        }
