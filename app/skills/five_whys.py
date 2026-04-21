from __future__ import annotations

from typing import Any, Dict, List

from app.skills.base import BaseSkill


class FiveWhysSkill(BaseSkill):
    @property
    def name(self) -> str:
        return "five_whys"

    @property
    def description(self) -> str:
        return "Drill into a strategic symptom using the Five Whys technique."

    def execute(self, **kwargs: Any) -> Dict[str, Any]:
        problem = kwargs.get("problem") or kwargs.get("text") or "Unclear strategic problem"
        whys: List[Dict[str, str]] = []
        prompts = [
            "Why is the issue visible now?",
            "Why did existing controls fail to surface it earlier?",
            "Why are incentives misaligned across owners?",
            "Why is the evidence base incomplete?",
            "Why has no accountable decision gate resolved it?",
        ]
        for index, question in enumerate(prompts, start=1):
            whys.append({"level": str(index), "question": question, "working_answer": "Requires human validation."})
        return {"status": "success", "skill": self.name, "problem": problem, "whys": whys}
