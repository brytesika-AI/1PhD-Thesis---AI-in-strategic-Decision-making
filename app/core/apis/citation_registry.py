from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict
from enum import Enum

class CitationTier(Enum):
    PRIMARY   = "Primary"    # Direct API / official source
    SECONDARY = "Secondary"  # Derived / aggregated data
    MODELLED  = "Modelled"   # AI-SRF calculation / estimate
    COMMUNITY = "Community"  # User-generated (ESP posts)

@dataclass
class Citation:
    source_name: str           
    source_type: str           
    url: str                   
    publication_date: str      
    accessed_date: str         
    tier: CitationTier         
    frbr_uri: Optional[str] = None  
    api_endpoint: Optional[str] = None
    doi: Optional[str] = None  
    page_reference: Optional[str] = None

    def format_inline(self) -> str:
        return f"({self.source_name}, {self.publication_date}) [{self.tier.value}]"

    def format_full(self) -> str:
        return f"{self.source_name}. ({self.publication_date}). *{self.source_type}*. Retrieved {self.accessed_date}, from {self.url}"

    def format_hover(self) -> str:
        lines = [
            f"Source: {self.source_name}",
            f"Type: {self.source_type}",
            f"URL: {self.url}",
            f"Published: {self.publication_date}",
            f"Accessed: {self.accessed_date}",
            f"Credibility: {self.tier.value}",
        ]
        if self.api_endpoint: lines.append(f"API Endpoint: {self.api_endpoint}")
        if self.frbr_uri: lines.append(f"FRBR URI: {self.frbr_uri}")
        return "\n".join(lines)

TODAY = datetime.now().strftime("%Y, %B %d")

CITATION_REGISTRY: Dict[str, Citation] = {
    "SARB_EXCHANGE_RATES": Citation(
        source_name="South African Reserve Bank (SARB)",
        source_type="Official Exchange Rate Statistics",
        url="https://www.resbank.co.za/en/home/what-we-do/statistics/selected-data",
        publication_date="Live — updated daily",
        accessed_date=TODAY,
        tier=CitationTier.PRIMARY,
        api_endpoint="https://custom.resbank.co.za/SarbWebApi/WebIndicators/"
    ),
    "ESKOMSEPUSH_STATUS": Citation(
        source_name="EskomSePush Business API 2.0",
        source_type="Real-Time Grid Status Feed",
        url="https://developer.sepush.co.za",
        publication_date="Live — real-time",
        accessed_date=TODAY,
        tier=CitationTier.PRIMARY,
        api_endpoint="https://developer.sepush.co.za/business/2.0/status"
    ),
    "STATS_SA_CPI": Citation(
        source_name="Statistics South Africa (Stats SA)",
        source_type="Consumer Price Index — Statistical Release P0141",
        url="https://www.statssa.gov.za/?page_id=1854&PPN=P0141",
        publication_date="2024, October",
        accessed_date=TODAY,
        tier=CitationTier.PRIMARY
    ),
    "LAWS_AFRICA_KING_IV": Citation(
        source_name="Institute of Directors South Africa (IoDSA)",
        source_type="King IV Report on Corporate Governance for South Africa, 2016",
        url="https://www.iodsa.co.za/page/KingIV",
        publication_date="2016",
        accessed_date=TODAY,
        tier=CitationTier.PRIMARY
    ),
    "LAWS_AFRICA_POPIA": Citation(
        source_name="Laws.Africa Content API",
        source_type="Protection of Personal Information Act 4 of 2013 — Akoma Ntoso XML",
        url="https://api.laws.africa/v3/akn/za/act/2013/4",
        publication_date="2013 (effective 2021, July 1)",
        accessed_date=TODAY,
        tier=CitationTier.PRIMARY,
        frbr_uri="/akn/za/act/2013/4"
    ),
    # Pre-populating other required sources
    "AISRF_PROPOSAL": Citation(
        source_name="Sikazwe, B. (2026). AI-driven Strategic Resilience Framework (AI-SRF)",
        source_type="PhD Proposal — University of Johannesburg",
        url="University of Johannesburg Repository",
        publication_date="2026",
        accessed_date=TODAY,
        tier=CitationTier.PRIMARY,
        doi="UJ-IKM-2026-Sikazwe"
    )
}
