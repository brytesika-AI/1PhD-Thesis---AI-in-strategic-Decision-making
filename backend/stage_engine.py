from typing import List, Dict, Any

def classify_environment_local(signals: List[Dict[str, Any]]) -> Dict[str, Any]:
    critical = sum(1 for s in signals if s["severity"] == "CRITICAL")
    high = sum(1 for s in signals if s["severity"] == "HIGH")
    
    if critical >= 3: state = "CRITICAL"
    elif critical >= 2: state = "COMPOUND"
    elif high >= 2: state = "ELEVATED"
    else: state = "NOMINAL"
    
    return {
        "risk_state": state,
        "confidence": 0.9,
        "triggering_signals": [s for s in signals if s["severity"] in ["HIGH", "CRITICAL"]]
    }

def fallback_stage_output(stage: int, decision_text: str, input_text: str, risk_state: str, sector: str, signals: list, option_id: str = None) -> Dict[str, Any]:
    # Minimal valid placeholders for each stage
    defaults = {
        1: {"diagnostic_questions": [{"question": "What is the primary constraint?", "tagged_signal": "energy"}]},
        2: {"risk_report": {"dependencies": [], "distributional_audit": [], "compliance": []}},
        3: {"strategic_options": [{"option_id": "OPT-001", "archetype": "HEDGE", "title": "Fallback Strategy", "ror_projections": {"decision_alpha": 0.5}}]},
        4: {"challenge_briefs": [{"option_id": "OPT-001", "verdict": "PROCEED"}]},
        5: {"implementation_plan": {"tasks": []}},
        6: {"ror_dashboard": {"decision_alpha": {"value": 1.0}, "infrastructure_autonomy_ratio": {"value": 0.85}, "algorithmic_sovereignty_yield": {"value": 0.9}}}
    }
    return defaults.get(stage, {})
