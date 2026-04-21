import json
import re
from typing import Any, Dict, List
from uuid import uuid4

from app.core.model_client import ModelClient
from app.agents.registry import AgentRegistry
from app.agents.output_schemas import validate_agent_output
from app.state.models import ApprovalGate, CaseState
from app.state.store import StateManager
from app.policy.engine import PolicyEngine
from app.audit.logger import AuditLogger
from app.skills import SKILLS_REGISTRY

class AgentOrchestrator:
    """
    AI-SRF Stage Transition & JSON Validation Engine.
    Implements the central orchestration gateway using declarative config and governance.
    """

    def __init__(self):
        self.registry = AgentRegistry()
        self.policy = PolicyEngine(self.registry.agents)
        self.model_client = ModelClient()
        
        status = self.model_client.provider_status()
        self.model_name = status["model"]
        
        self.agent_map = {
            1: "tracker",
            2: "induna",
            3: "auditor",
            4: "innovator",
            5: "challenger",
            6: "architect",
            7: "guardian"
        }

    def _parse_json_safely(self, text: str) -> Dict[str, Any]:
        """Extract and parse JSON from agent output."""
        try:
            json_match = re.search(r'(\{.*\}|\[.*\])', text, re.DOTALL)
            if json_match:
                return json.loads(json_match.group(1))
            return json.loads(text)
        except Exception:
            return {"error": "Invalid JSON output", "raw": text}

    def run_tool(self, agent_id: str, tool_name: str, case_id: str = "", **kwargs: Any) -> Dict[str, Any]:
        """Invoke a tool passing through policy governance."""
        policy_check = self.policy.build_tool_policy_check(agent_id, tool_name)
        if not policy_check["allowed"]:
            result = {"status": "error", "message": policy_check["reason"], "policy_check": policy_check}
            if case_id:
                AuditLogger.log_event(
                    case_id=case_id,
                    agent_id=agent_id,
                    input_summary=f"Tool request: {tool_name}",
                    output_summary=policy_check["reason"],
                    tools_used=[],
                    model_used="policy-engine",
                    policy_checks=[policy_check],
                    human_approval=False,
                    raw_payload=result,
                    event_type="tool_denied",
                )
            return result

        skill = SKILLS_REGISTRY.get(tool_name)
        if not skill:
            policy_check["allowed"] = False
            policy_check["reason"] = f"Tool {tool_name} not found in skills registry."
            return {"status": "error", "message": policy_check["reason"], "policy_check": policy_check}

        result = skill.execute(**kwargs)
        result["policy_check"] = policy_check
        if case_id:
            AuditLogger.log_event(
                case_id=case_id,
                agent_id=agent_id,
                input_summary=f"Tool request: {tool_name}",
                output_summary=str(result)[:240],
                tools_used=[tool_name],
                model_used="local-skill",
                policy_checks=[policy_check],
                human_approval=policy_check["requires_human_approval"],
                raw_payload=result,
                event_type="tool_invocation",
            )
        return result

    def _requested_tools(self, parsed_json: Dict[str, Any], agent_conf: Dict[str, Any]) -> List[str]:
        requested = parsed_json.get("tools_used") or parsed_json.get("requested_tools") or []
        if isinstance(requested, str):
            requested = [requested]
        allowed = agent_conf.get("allowed_tools", [])
        return [tool for tool in requested if tool in allowed]

    def _update_state_from_stage(self, state: CaseState, stage_id: int, payload: Dict[str, Any], audit_ref: str) -> None:
        """Persist structured outputs in the decision-case state model."""
        state.stage_outputs[str(stage_id)] = payload
        state.audit_log_refs.append(audit_ref)
        if stage_id == 1:
            state.user_goal = state.user_goal or str(payload.get("strategic_tension") or payload.get("finding") or "")
            state.evidence_bundle["signals"] = payload.get("signals", [])
        elif stage_id == 2:
            state.assumptions.extend([a for a in payload.get("assumptions", []) if a not in state.assumptions])
        elif stage_id == 3:
            state.evidence_bundle.update(payload.get("evidence", {}))
            state.evidence_bundle["compliance_verdict"] = payload.get("compliance_verdict")
        elif stage_id == 4:
            state.options_generated = payload.get("options", state.options_generated)
        elif stage_id == 5:
            state.devil_advocate_findings = {
                "stress_tests": payload.get("stress_tests", []),
                "verdict": payload.get("verdict") or payload.get("finding"),
            }
        elif stage_id == 6:
            state.implementation_plan = payload.get("implementation_plan", payload.get("plan", {}))
        elif stage_id == 7:
            state.monitoring_rules = payload.get("monitoring_rules", state.monitoring_rules)
            state.status = "monitoring"

    def _pending_approval_for_stage(self, state: CaseState, stage_id: int) -> ApprovalGate | None:
        for gate in state.approval_gates:
            if gate.stage_id == stage_id and gate.status == "pending":
                return gate
        return None

    def _latest_pending_approval(self, state: CaseState) -> ApprovalGate | None:
        for gate in reversed(state.approval_gates):
            if gate.status == "pending":
                return gate
        return None

    def _create_approval_gate(self, state: CaseState, stage_id: int, agent_id: str, audit_ref: str) -> ApprovalGate:
        existing = self._pending_approval_for_stage(state, stage_id)
        if existing:
            return existing
        gate = ApprovalGate(
            approval_id=str(uuid4()),
            stage_id=stage_id,
            agent_id=agent_id,
            audit_ref=audit_ref,
        )
        state.approval_gates.append(gate)
        return gate

    async def execute_stage(self, case_id: str, stage_id: int, user_input: str, risk_state: str, sector: str) -> Dict[str, Any]:
        """Execute a specific stage in the pipeline."""

        state = StateManager.get_case(case_id)
        if not state:
            state = CaseState(case_id=case_id, user_goal=user_input[:500])

        pending_gate = self._latest_pending_approval(state)
        if pending_gate and stage_id > pending_gate.stage_id:
            return {
                "error": "Human approval required before the next stage can execute.",
                "approval_required": True,
                "approval_gate": pending_gate.model_dump(),
                "case_state": state.model_dump(),
            }

        agent_id = self.agent_map.get(stage_id)
        if not agent_id:
            return {"error": "Invalid stage ID"}

        agent_conf = self.registry.get_agent(agent_id)
        system_prompt = self.registry.get_system_prompt(agent_id)

        injected_context = f"ENVIRONMENT: {risk_state} | SECTOR: {sector}\n"
        injected_context += "CURRENT CASE STATE: "
        injected_context += state.model_dump_json(include={"current_stage", "status", "user_goal", "assumptions"})
        injected_context += "\nGOVERNANCE: Return valid JSON. Use only declared tools. Human approval gates are mandatory."

        prompt = system_prompt + "\n\n" + injected_context

        response_text = await self.model_client.complete(
            system_prompt=prompt,
            messages=[{"role": "user", "content": user_input}],
            fallback_text='{"error": "Model offline or degraded."}'
        )

        parsed_json = self._parse_json_safely(response_text)
        parsed_json = validate_agent_output(agent_conf.get("output_schema", ""), parsed_json)

        tool_results: Dict[str, Any] = {}
        policy_checks: List[Dict[str, Any]] = []
        for tool_name in self._requested_tools(parsed_json, agent_conf):
            tool_result = self.run_tool(
                agent_id=agent_id,
                tool_name=tool_name,
                case_id=case_id,
                text=user_input,
                context=state.model_dump(),
            )
            tool_results[tool_name] = tool_result
            policy_check = tool_result.get("policy_check")
            if policy_check:
                policy_checks.append(policy_check)

        parsed_json["tool_results"] = tool_results
        tools_used = list(tool_results.keys())

        handoff_target = self.registry.next_agent_id(agent_id)
        handoff_check = {
            "agent_id": agent_id,
            "handoff_target": handoff_target,
            "allowed": handoff_target == self.agent_map.get(stage_id + 1) or handoff_target is None,
            "reason": "Declarative handoff rule evaluated.",
        }
        policy_checks.append(handoff_check)

        audit_ref = AuditLogger.log_event(
            case_id=case_id,
            agent_id=agent_id,
            input_summary=user_input[:100],
            output_summary=str(parsed_json)[:240],
            tools_used=tools_used,
            model_used=self.model_name,
            policy_checks=policy_checks,
            human_approval=self.policy.requires_approval(agent_id),
            raw_payload=parsed_json
        )

        self._update_state_from_stage(state, stage_id, parsed_json, audit_ref)
        approval_gate = None
        if self.policy.requires_approval(agent_id):
            approval_gate = self._create_approval_gate(state, stage_id, agent_id, audit_ref)
            state.current_stage = stage_id
            state.status = "awaiting_approval"
        else:
            state.current_stage = min(stage_id + 1, 7)
        StateManager.save_case(state)

        return {
            "round": stage_id,
            "agent": agent_conf.get("display_name", agent_id),
            "content": parsed_json,
            "raw": response_text,
            "case_state": state.model_dump(),
            "audit_ref": audit_ref,
            "approval_required": approval_gate is not None,
            "approval_gate": approval_gate.model_dump() if approval_gate else None,
        }
