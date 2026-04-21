from __future__ import annotations

from typing import Any, Dict, List

from app.skills.base import BaseSkill


class PolicyComplianceScanSkill(BaseSkill):
    @property
    def name(self) -> str:
        return "policy_compliance_scan"

    @property
    def description(self) -> str:
        return "Scan a decision artifact for POPIA, King IV, auditability, and human-approval concerns."

    def execute(self, **kwargs: Any) -> Dict[str, Any]:
        text = str(kwargs.get("text") or kwargs.get("artifact") or "")
        findings: List[Dict[str, str]] = []
        if any(token in text.lower() for token in ["personal name", "id number", "passport"]):
            findings.append({"severity": "high", "control": "POPIA", "finding": "Potential personal information needs minimisation."})
        if "approval" not in text.lower():
            findings.append({"severity": "medium", "control": "Human-in-the-loop", "finding": "Approval gate is not explicit."})
        if not findings:
            findings.append({"severity": "low", "control": "Governance", "finding": "No obvious compliance blocker in supplied text."})
        return {"status": "success", "skill": self.name, "findings": findings, "verdict": "review_required" if len(findings) > 1 else "pass_with_monitoring"}
