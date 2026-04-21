import json
from pathlib import Path
from typing import List, Dict, Any, Optional
from app.state.models import CaseState

WORKSPACE_DIR = Path(__file__).parent.parent.parent / "workspace"
CASES_DIR = WORKSPACE_DIR / "cases"
CASES_DIR.mkdir(parents=True, exist_ok=True)


class StateManager:
    @staticmethod
    def get_case(case_id: str) -> Optional[CaseState]:
        case_file = CASES_DIR / f"{case_id}.json"
        if not case_file.exists():
            return None
        with open(case_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            return CaseState(**data)

    @staticmethod
    def save_case(state: CaseState) -> None:
        case_file = CASES_DIR / f"{state.case_id}.json"
        with open(case_file, "w", encoding="utf-8") as f:
            f.write(state.model_dump_json(indent=2))

    @staticmethod
    def list_cases(limit: int = 20) -> List[CaseState]:
        files = sorted(CASES_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True)
        runs = []
        for f in files[:limit]:
            with open(f, "r", encoding="utf-8") as r:
                try:
                    runs.append(CaseState(**json.load(r)))
                except Exception:
                    pass
        return runs
