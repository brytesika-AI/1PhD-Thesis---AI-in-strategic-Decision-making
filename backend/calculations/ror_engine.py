from dataclasses import dataclass, field
from typing import Optional
import re

@dataclass
class RORState:
    """
    Live Return on Resilience calculation state.
    Updates every time the executive provides new data.
    """
    investment_total: float = 0.0
    current_recovery_pct: float = 0.0
    projected_recovery_pct: float = 0.0
    gauntlet_conditions_passed: int = 0
    gauntlet_conditions_total: int = 10

    @property
    def current_recovery_value(self) -> float:
        return self.investment_total * (self.current_recovery_pct / 100)

    @property
    def unrealised_value(self) -> float:
        return self.investment_total - self.current_recovery_value

    @property
    def projected_recovery_value(self) -> float:
        # If not set, assume 80% recovery target if Gauntlet is passed
        if self.projected_recovery_pct == 0 and self.gauntlet_conditions_total > 0:
            return self.investment_total * 0.8
        return self.investment_total * (self.projected_recovery_pct / 100)

    @property
    def ror_delta(self) -> float:
        """Value recovered by implementing recommendation."""
        return self.projected_recovery_value - self.current_recovery_value

    @property
    def gauntlet_score_pct(self) -> float:
        if self.gauntlet_conditions_total == 0: return 0.0
        return (self.gauntlet_conditions_passed / self.gauntlet_conditions_total) * 100

    def format_for_prompt(self) -> str:
        """
        Returns formatted ROR block for agent injection.
        Always shows live numbers.
        """
        if self.investment_total == 0:
            return "## RETURN ON RESILIENCE (ROR) — ANALYSIS REQUIRED\nROR calculation requires investment figure — ask executive before next stage."

        return f"""
## RETURN ON RESILIENCE (ROR) — LIVE CALCULATION

| Metric | Value |
|---|---|
| Total Investment | R{self.investment_total:.0f}M |
| Current Recovery | {self.current_recovery_pct:.0f}% → R{self.current_recovery_value:.1f}M |
| Unrealised Value | **R{self.unrealised_value:.1f}M** |
| Projected Recovery (post-intervention) | {self.projected_recovery_pct or 80:.0f}% → R{self.projected_recovery_value:.1f}M |
| **ROR Delta** | **R{self.ror_delta:.1f}M recoverable** |
| Digital Gauntlet | {self.gauntlet_conditions_passed}/{self.gauntlet_conditions_total} conditions passed ({self.gauntlet_score_pct:.0f}%) |

> Source: AI-SRF Return on Resilience methodology
> (AI-SRF Proposal, Sikazwe, 2026)
"""

    def format_for_display(self) -> dict:
        """Returns dict for Streamlit metric display."""
        return {
            "investment": f"R{self.investment_total:.0f}M",
            "recovery": f"{self.current_recovery_pct:.0f}% (R{self.current_recovery_value:.1f}M)",
            "unrealised": f"R{self.unrealised_value:.1f}M",
            "ror_delta": f"R{self.ror_delta:.1f}M",
            "gauntlet": f"{self.gauntlet_conditions_passed}/{self.gauntlet_conditions_total}"
        }

def extract_financials_from_input(text: str) -> dict:
    """
    Extract financial figures from executive input.
    Called after every executive response.
    """
    result = {}
    
    # Match: R47 million, R47M, R47m, R 47 million
    rand_pattern = r'[Rr]\s?(\d+(?:\.\d+)?)\s*(?:million|m\b|M\b)'
    matches = re.findall(rand_pattern, text)
    if matches:
        result['investment_total'] = float(matches[0])

    # Match: 20%, 20 percent
    pct_pattern = r'(\d+(?:\.\d+)?)\s*(?:%|percent)'
    pct_matches = re.findall(pct_pattern, text)
    if pct_matches:
        # First percentage found = current recovery
        result['current_recovery_pct'] = float(pct_matches[0])

    return result
