from dataclasses import dataclass
from typing import Any
from .citation_registry import CITATION_REGISTRY, Citation, CitationTier

@dataclass
class CitedDataPoint:
    """
    A data point with its citation permanently attached.
    The Tracker only outputs CitedDataPoints — never raw numbers.
    """
    value: Any                    # The actual figure
    label: str                    # What it measures
    citation_key: str             # Key in CITATION_REGISTRY
    interpretation: str           # Strategic implication
    confidence: str = "HIGH"      # HIGH / MEDIUM / LOW

    @property
    def citation(self) -> Citation:
        return CITATION_REGISTRY.get(self.citation_key, CITATION_REGISTRY["AISRF_PROPOSAL"])

    def format_for_output(self) -> str:
        """Formats as a single auditable line for Tracker output."""
        tier_icon = {
            CitationTier.PRIMARY:   "🟢",
            CitationTier.SECONDARY: "🟡",
            CitationTier.MODELLED:  "🔵",
            CitationTier.COMMUNITY: "⚪",
        }.get(self.citation.tier, "⚪")

        return (
            f"**{self.label}:** {self.value} "
            f"{self.citation.format_inline()} "
            f"{tier_icon}\n"
            f"  → *{self.interpretation}*"
        )

    def format_for_prompt(self) -> str:
        """Formats for injection into agent system prompt."""
        return (
            f"- {self.label}: {self.value}. "
            f"Source: {self.citation.source_name} ({self.citation.publication_date}). "
            f"Credibility: {self.citation.tier.value}. "
            f"Implication: {self.interpretation}"
        )
