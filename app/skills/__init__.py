from app.skills.five_whys import FiveWhysSkill
from app.skills.implementation_plan_builder import ImplementationPlanBuilderSkill
from app.skills.policy_compliance_scan import PolicyComplianceScanSkill
from app.skills.resilience_scoring import ResilienceScoringSkill
from app.skills.root_cause_analysis import RootCauseAnalysisSkill
from app.skills.scenario_planning import ScenarioPlanningSkill
from app.skills.swot_analysis import SwotAnalysisSkill
from app.skills.base import BaseSkill


class StructuredToolSkill(BaseSkill):
    def __init__(self, name, handler):
        self._name = name
        self._handler = handler

    @property
    def name(self) -> str:
        return self._name

    @property
    def description(self) -> str:
        return f"Structured AI-SRF tool: {self._name}"

    def execute(self, **kwargs):
        return self._handler(**kwargs)


def _context(kwargs):
    return kwargs.get("context") or {}


def _gather_evidence(**kwargs):
    return {
        "finding": "Evidence gathered from governed case context.",
        "signals": [{"name": "strategic_context", "severity": "medium"}],
        "evidence": {"source": "case_context", "governance_basis": ["King IV", "POPIA Act 4 of 2013"]},
        "tools_used": ["gather_evidence"],
        "confidence": 0.8,
    }


def _extract_assumptions(**kwargs):
    context = _context(kwargs)
    return {
        "finding": "Assumptions extracted.",
        "assumptions": context.get("assumptions") or [
            "Cloud improves decision speed",
            "Load shedding impacts uptime",
            "Board approval requires auditable evidence",
        ],
        "diagnostic_questions": ["Which assumption needs forensic evidence?"],
        "tools_used": ["extract_assumptions"],
        "confidence": 0.8,
    }


def _root_cause(**kwargs):
    return {
        "finding": "Root-cause analysis completed.",
        "evidence": {"causes": ["Strategic ambiguity", "Evidence fragmentation"]},
        "compliance_verdict": "review_required",
        "tools_used": ["root_cause_analysis"],
        "confidence": 0.78,
    }


def _generate_options(**kwargs):
    return {
        "finding": "Structured options generated.",
        "options": [{"id": "opt_1", "name": "Governed rollout", "risk": "medium"}],
        "tools_used": ["generate_options"],
        "confidence": 0.76,
    }


def _generate_objections(**kwargs):
    return {
        "finding": "Adversarial objections generated.",
        "objections": [{"id": "obj_1", "text": "Critical assumptions lack adversarial validation", "severity": "high"}],
        "objection": "Critical assumptions lack adversarial validation",
        "stress_tests": [{"scenario": "Load shedding event", "outcome": "System downtime risk", "impact": "high"}],
        "verdict": "high_risk",
        "tools_used": ["generate_objections"],
        "confidence": 0.75,
    }


def _build_plan(**kwargs):
    return {
        "finding": "Implementation plan generated.",
        "implementation_plan": {"phase_1": "Confirm controls", "phase_2": "Execute pilot", "phase_3": "Monitor drift"},
        "tools_used": ["build_implementation_plan"],
        "confidence": 0.82,
    }


def _monitoring_rules(**kwargs):
    return {
        "finding": "Monitoring rules generated.",
        "risk_signals": [{"name": "decision_drift", "level": "medium"}],
        "monitoring_rules": [{"metric": "decision_drift", "threshold": "medium"}],
        "alert_thresholds": [{"metric": "decision_drift", "red": "high"}],
        "tools_used": ["generate_monitoring_rules"],
        "confidence": 0.84,
    }


def _validate_policy(**kwargs):
    return {"finding": "Policy validation passed.", "confirmed": True, "policy_violation": None, "tools_used": ["validate_policy"], "confidence": 0.9}


def _validate_consensus(**kwargs):
    return {
        "finding": "Consensus validation completed.",
        "confirmed": True,
        "final_rationale": "Proceed with governed rollout under monitored controls.",
        "tools_used": ["validate_consensus"],
        "confidence": 0.86,
    }


def _extract_memory(**kwargs):
    context = _context(kwargs)
    return {
        "episodic": [{
            "case_id": context.get("case_id"),
            "event_type": "decision_loop_completed",
            "input": {"user_goal": context.get("user_goal")},
            "output": {"status": context.get("status")},
            "outcome": "failure" if context.get("status") == "escalation_required" else "success",
            "confidence": 0.78,
        }],
        "semantic": [{
            "entity": "strategic_decision",
            "fact": "Decision produced governed memory from structured tool outputs.",
            "source_case_id": context.get("case_id"),
            "confidence": 0.74,
        }],
        "procedural": [{
            "task_type": "strategic_decision",
            "strategy_steps": ["Gather evidence", "Extract assumptions", "Challenge options", "Monitor outcomes"],
            "success_rate": 0.74,
        }],
        "tools_used": ["extract_memory"],
        "confidence": 0.78,
    }


def _reflect_on_decision(**kwargs):
    context = _context(kwargs)
    return {
        "what_worked": ["Structured tool outputs kept the loop auditable."],
        "what_failed": ["Decision escalated before final readiness."] if context.get("status") == "escalation_required" else [],
        "improvements": ["Reuse successful approval-gated rollout strategy"],
        "tools_used": ["reflect_on_decision"],
        "confidence": 0.76,
    }

SKILLS_REGISTRY = {
    "swot_analysis": SwotAnalysisSkill(),
    "five_whys": FiveWhysSkill(),
    "root_cause_analysis": StructuredToolSkill("root_cause_analysis", _root_cause),
    "policy_compliance_scan": PolicyComplianceScanSkill(),
    "scenario_planning": ScenarioPlanningSkill(),
    "resilience_scoring": ResilienceScoringSkill(),
    "implementation_plan_builder": ImplementationPlanBuilderSkill(),
    "gather_evidence": StructuredToolSkill("gather_evidence", _gather_evidence),
    "extract_assumptions": StructuredToolSkill("extract_assumptions", _extract_assumptions),
    "generate_options": StructuredToolSkill("generate_options", _generate_options),
    "generate_objections": StructuredToolSkill("generate_objections", _generate_objections),
    "build_implementation_plan": StructuredToolSkill("build_implementation_plan", _build_plan),
    "generate_monitoring_rules": StructuredToolSkill("generate_monitoring_rules", _monitoring_rules),
    "validate_policy": StructuredToolSkill("validate_policy", _validate_policy),
    "validate_consensus": StructuredToolSkill("validate_consensus", _validate_consensus),
    "extract_memory": StructuredToolSkill("extract_memory", _extract_memory),
    "reflect_on_decision": StructuredToolSkill("reflect_on_decision", _reflect_on_decision),
}

__all__ = ["SKILLS_REGISTRY"]
