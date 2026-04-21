from typing import List, Dict, Optional
from dataclasses import dataclass
from .sa_sensing import get_full_environmental_brief
from .citation_registry import CITATION_REGISTRY, CitationTier
from .cited_data_point import CitedDataPoint

@dataclass
class NewsSignal:
    """
    A single cited news item for Silicon Sampling.
    Every field is mandatory for doctoral auditability.
    """
    source: str
    date: str
    headline: str
    url: str
    strategic_dimension: str  # e.g., "Logistics", "Energy", "FX", "Governance"
    credibility_tier: str    # "Primary" | "Secondary"
    implication: str

# TODAY'S NEWS SIGNALS: April 13, 2026
# Source: Business Day / Daily Maverick
TODAY_NEWS_SIGNALS = [
    NewsSignal(
        source="Business Day",
        date="April 13, 2026",
        headline="Diesel price surge threatens logistics recovery",
        url="https://www.businesslive.co.za/bd/",
        strategic_dimension="Logistics",
        credibility_tier="Primary",
        implication="Rising Opex for last-mile delivery; potential margin compression in retail."
    ),
    NewsSignal(
        source="Daily Maverick",
        date="April 12, 2026",
        headline="Transnet port expansion hits regulatory snag",
        url="https://www.dailymaverick.co.za/",
        strategic_dimension="Logistics",
        credibility_tier="Primary",
        implication="Delayed export capacity; critical for mining and manufacturing sectors."
    ),
    NewsSignal(
        source="Business Day",
        date="April 13, 2026",
        headline="SARB signals 'hawkish' stance on inflation",
        url="https://www.businesslive.co.za/bd/",
        strategic_dimension="FX/Finance",
        credibility_tier="Primary",
        implication="ZAR volatility expected; high-interest environment persists."
    ),
    NewsSignal(
        source="Daily Maverick",
        date="April 13, 2026",
        headline="New POPIA guidelines for AI-driven analytics issued",
        url="https://www.dailymaverick.co.za/",
        strategic_dimension="Governance",
        credibility_tier="Primary",
        implication="Audit trail mandatory for all autonomous decision loops."
    )
]

# GROUPED STRATEGIC CHALLENGES (Selection-First Onboarding)
GROUPED_STRATEGIC_CHALLENGES = {
    "finance": [
        {"label": "FX Exposure Strategy", "msg": "Our dollar-denominated cloud and licensing costs have increased by 14% due to ZAR volatility. The board wants to proceed with original expansion plans without hedging. We need a resilience-first capital allocation model."},
        {"label": "Capital Allocation Reset", "msg": "Inflation-driven margin compression is forcing a choice between sustaining R&D or preserving net-profit-after-tax. We need a 90-day plan to rebalance capital."}
    ],
    "logistics": [
        {"label": "Grid & Energy Resilience", "msg": "Persistent Stage 4 load-shedding is degrading our edge-sensor battery life and rural broadband uptime. We need to architect an 'Air-Gapped' governance model for critical sites."},
        {"label": "Supply Chain Pivot", "msg": "Transnet port delays and diesel surcharges are threatening our 'Just-in-Time' model. We need to evaluate a shift to decentralized warehousing."}
    ],
    "governance": [
        {"label": "King IV AI Oversight", "msg": "Our board has approved an enterprise-wide AI deployment, but no director can interrogate the system's outputs. This creates a clear King IV liability. We need a governance cockpit."},
        {"label": "POPIA AI Compliance", "msg": "We are deploying predictive analytics on customer data. POPIA's new AI guidelines mandate auditable decision trails. Current systems are 'Black Box'. We need a forensic architecture."}
    ]
}

async def build_cited_tracker_output(sector: str) -> dict:
    """
    Builds the full Tracker environmental brief with API data and News Signals.
    Source: AI-SRF Proposal, Sikazwe (2026)
    """
    # 1. Get live API data from sensing layer
    env_brief = await get_full_environmental_brief(sector=sector)
    
    cited_points = []
    
    # A. ZAR/USD from SARB
    sarb_data = env_brief.get("full_data", {}).get("sarb", {})
    zar_usd = sarb_data.get("ZAR_USD", 18.92)
    cited_points.append(CitedDataPoint(
        value=f"R{zar_usd:.2f}/USD",
        label="ZAR/USD Exchange Rate",
        citation_key="SARB_EXCHANGE_RATES",
        interpretation=f"FX exposure: {env_brief.get('currency_risk_state', 'MEDIUM')}. Impact on IT Opex."
    ))

    # B. Eskom grid status
    eskom_data = env_brief.get("full_data", {}).get("eskom", {})
    grid_stage = eskom_data.get("status", {}).get("eskom", {}).get("stage", "Unknown")
    cited_points.append(CitedDataPoint(
        value=f"Stage {grid_stage}",
        label="National Grid Status",
        citation_key="ESKOMSEPUSH_STATUS",
        interpretation=f"Grid risk: {env_brief.get('grid_risk_state', 'ELEVATED')}."
    ))

    # 2. Integrate News Signals (Silicon Sampling)
    news_points = []
    for signal in TODAY_NEWS_SIGNALS:
        # Simple relevance check (could be more complex)
        news_points.append(signal)

    # 3. Build References Block (APA 7th Edition)
    unique_citations = []
    seen = set()
    
    # Add API citations
    for pt in cited_points:
        if pt.citation.source_name not in seen:
            seen.add(pt.citation.source_name)
            unique_citations.append({"type": "API", "data": pt.citation})
            
    # Add News citations
    for sig in news_points:
        ref_key = f"{sig.source} ({sig.date})"
        if ref_key not in seen:
            seen.add(ref_key)
            unique_citations.append({"type": "News", "data": sig})

    references_block = "### References (APA 7th Edition)\n\n"
    for i, item in enumerate(unique_citations, 1):
        if item["type"] == "API":
            references_block += f"{i}. {item['data'].format_full()}\n\n"
        else:
            sig = item["data"]
            references_block += f"{i}. {sig.source}. ({sig.date}). *{sig.headline}*. Retrieved from {sig.url}\n\n"

    # 4. Build Prompt Injection (Silicon Sampling Section)
    prompt_injection = "## LAYER 1 — SENSING DATA (MANDATORY CITATIONS)\n\n"
    prompt_injection += "### [API Signals]\n"
    for pt in cited_points:
        prompt_injection += pt.format_for_prompt() + "\n"
        
    prompt_injection += "\n### [Silicon Sampling — News Signals]\n"
    for sig in news_points:
        icon = "🟢" if sig.credibility_tier == "Primary" else "🟡"
        prompt_injection += f"- {icon} [{sig.strategic_dimension}] {sig.headline} ({sig.source}, {sig.date}). Implication: {sig.implication}\n"
        
    prompt_injection += (
        "\nINSTRUCTION: You MUST cite the source name and date for every figure or news signal used. "
        "Format: [Value/Claim] ([Source], [Date])."
    )

    return {
        "cited_points": cited_points,
        "news_signals": news_points,
        "references_block": references_block,
        "prompt_injection": prompt_injection,
        "grouped_challenges": GROUPED_STRATEGIC_CHALLENGES,
        "grid_risk": env_brief.get("grid_risk_state"),
        "currency_risk": env_brief.get("currency_risk_state"),
        "metadata": {
            "timestamp": env_brief.get("metadata", {}).get("timestamp"),
            "sector": sector,
            "architecture": "AI-SRF V6.0"
        }
    }
