"""
AI-SRF Return on Resilience (ROR) Engine
Four-indicator measurement architecture.
Source: AI-SRF Proposal, Sikazwe (2026)
"""
from dataclasses import dataclass, field
from typing import Optional, List
import time
import re

@dataclass
class RORState:
    """
    Four ROR indicators as defined in the AI-SRF
    doctoral framework (Sikazwe, 2026).
    All update live as session data accumulates.
    """

    # ── Indicator 1: Decision Latency Reduction ──────
    # DLR = ((T_baseline - T_aisrf) / T_baseline) × 100
    t_baseline_minutes: float = 60.0    # Default 1 hour manual baseline
    t_aisrf_minutes: float = 0.0       # AI-SRF decision time
    session_start_time: float = field(
        default_factory=time.time
    )

    @property
    def dlr(self) -> Optional[float]:
        """Decision Latency Reduction %"""
        if self.t_baseline_minutes == 0:
            return None
        elapsed = (
            time.time() - self.session_start_time
        ) / 60
        self.t_aisrf_minutes = elapsed
        return (
            (self.t_baseline_minutes - elapsed)
            / self.t_baseline_minutes
        ) * 100

    # ── Indicator 2: Decision Alpha ──────────────────
    # αD = Σ(E_ai - E_human) / n
    # Expert panel ratings (1–10 scale)
    ai_decision_ratings: List[float] = field(
        default_factory=list
    )
    human_decision_ratings: List[float] = field(
        default_factory=list
    )

    @property
    def decision_alpha(self) -> Optional[float]:
        """Decision Alpha — quality improvement score"""
        if not self.ai_decision_ratings:
            return None
        if len(self.ai_decision_ratings) != len(
            self.human_decision_ratings
        ):
            return None
        n = len(self.ai_decision_ratings)
        total = sum(
            self.ai_decision_ratings[i]
            - self.human_decision_ratings[i]
            for i in range(n)
        )
        return total / n

    # ── Indicator 3: Infrastructure Autonomy Ratio ───
    # IAR = (F_operational / F_total) × 100
    functions_total: int = 7           # 7 agents
    functions_operational: int = 7     # Update on API failure

    @property
    def iar(self) -> float:
        """
        Infrastructure Autonomy Ratio —
        % of agent functions operational during
        grid/connectivity disruption.
        """
        if self.functions_total == 0:
            return 0.0
        return (
            self.functions_operational
            / self.functions_total
        ) * 100

    # ── Indicator 4: Algorithmic Sovereignty Yield ───
    # ASY = (C_integrated / C_injected) × 100
    regulatory_constraints_injected: int = 0
    regulatory_constraints_cited: int = 0

    @property
    def asy(self) -> Optional[float]:
        """
        Algorithmic Sovereignty Yield —
        % of injected regulatory constraints
        explicitly cited in agent reasoning.
        """
        if self.regulatory_constraints_injected == 0:
            return None
        return (
            self.regulatory_constraints_cited
            / self.regulatory_constraints_injected
        ) * 100

    # ── Gauntlet + Financial (from prior version) ────
    investment_total: float = 47.0     # R47M default
    current_recovery_pct: float = 20.0
    projected_recovery_pct: float = 0.0
    gauntlet_conditions_passed: int = 0
    gauntlet_conditions_total: int = 10

    @property
    def unrealised_value(self) -> float:
        return self.investment_total * (
            1 - self.current_recovery_pct / 100
        )

    @property
    def ror_delta(self) -> float:
        return self.investment_total * (
            (self.projected_recovery_pct
             - self.current_recovery_pct) / 100
        )

    def format_full_ror_block(self) -> str:
        """
        Full 4-indicator ROR block for agent injection.
        Source: AI-SRF Proposal, Sikazwe (2026)
        """
        dlr_str = (
            f"{self.dlr:.1f}%"
            if self.dlr is not None
            else "Calculating..."
        )
        alpha_str = (
            f"{self.decision_alpha:+.2f}"
            if self.decision_alpha is not None
            else "Pending expert validation"
        )
        asy_str = (
            f"{self.asy:.1f}%"
            if self.asy is not None
            else f"0/{self.regulatory_constraints_injected}"
              " constraints cited"
        )

        return f"""
## RETURN ON RESILIENCE — LIVE DASHBOARD
(AI-SRF Proposal, Sikazwe, 2026)

### Indicator 1 — Decision Latency Reduction (DLR)
Formula: DLR = ((T_baseline − T_AI-SRF) / T_baseline) × 100
Result: **{dlr_str}**
Baseline (manual): {self.t_baseline_minutes:.0f} min
AI-SRF elapsed: {self.t_aisrf_minutes:.1f} min

### Indicator 2 — Decision Alpha (αD)
Formula: αD = Σ(E_AI − E_Human) / n
Result: **{alpha_str}** (positive = AI outperforms)
Ratings collected: {len(self.ai_decision_ratings)}

### Indicator 3 — Infrastructure Autonomy Ratio (IAR)
Formula: IAR = (F_operational / F_total) × 100
Result: **{self.iar:.0f}%**
({self.functions_operational}/{self.functions_total}
agents operational under current grid conditions)

### Indicator 4 — Algorithmic Sovereignty Yield (ASY)
Formula: ASY = (C_integrated / C_injected) × 100
Result: **{asy_str}**
Regulatory constraints injected: {self.regulatory_constraints_injected}
Constraints cited in reasoning: {self.regulatory_constraints_cited}

---
### Financial ROR Summary
| Metric | Value |
|---|---|
| Total Investment | R{self.investment_total:.0f}M |
| Current Recovery | {self.current_recovery_pct:.0f}% → R{self.investment_total * self.current_recovery_pct/100:.1f}M |
| Unrealised Value | **R{self.unrealised_value:.1f}M** |
| Projected Recovery | {self.projected_recovery_pct:.0f}% → R{self.investment_total * self.projected_recovery_pct/100:.1f}M |
| ROR Delta | **R{self.ror_delta:.1f}M recoverable** |

### Digital Gauntlet
Score: {self.gauntlet_conditions_passed:.1f}/{self.gauntlet_conditions_total} conditions ({self.gauntlet_conditions_passed/self.gauntlet_conditions_total*100:.0f}%)
"""

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
