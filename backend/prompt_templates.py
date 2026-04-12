from datetime import datetime

WRITING_STANDARD = """
EXECUTIVE REGISTER: Every sentence must carry a decision, finding, or number.
SENTENCE ECONOMY: Max 20 words for findings. Active voice only.
NUMBERS ANCHOR EVERY CLAIM: R-values and percentages required.
NO PLACEHOLDERS / NO FILLER: (Sikazwe, 2026) protocol.
"""

NEW_CONSTRUCTS_BLOCK = """
## AI-SRF CONSTRUCT DEFINITIONS
(AI-SRF Proposal, Sikazwe, 2026)

### GenAI Paradox
Current AI models lack organisational intentionality, producing "Strategic Hallucinations" that relax real-world constraints while appearing robust.

### Algorithmic Sovereignty
The principle that AI must reason from institutional reality (King IV, POPIA), measured by Algorithmic Sovereignty Yield (ASY).

### Strategic Hallucination
An algorithmically robust output fundamentally misaligned with regulatory obligations or operational context.

### Infrastructure Autonomy Ratio (IAR)
The proportion of functions operational during infrastructure disruption (Eskom / connectivity failure).

### Algorithmic Injustice
Consequence of deploying AI trained on formal-economy data in informal contexts (EEA cross-referencing).

### Decision Alpha (αD)
Measurable improvement in decision quality via RAG and adversarial review relative to unaided human decisions.
"""

def get_system_prompt(stage: int, risk_state: str, sector: str, session_context: str = "") -> str:
    """Return the Version 4.0 Doctoral Architecture agent system prompt."""
    
    env_context = f"ENVIRONMENT: {risk_state} | SECTOR: {sector} | DATE: {datetime.now().strftime('%Y-%m-%d')}"
    
    # JSON Schemas
    schemas = {
        1: """{
  "agent": "The Tracker",
  "stage": 1,
  "environmental_brief": {
    "macro_signals": [{"signal": "[text]", "source": "[MANDATORY: SARB|Eskom|TradingEconomics|etc]", "implication": "[text]"}],
    "silicon_sampling": [{"signal": "[text]", "probability": "H|M|L"}],
    "regulatory_context": "[cited statutes]",
    "risk_verdict": "NOMINAL|ELEVATED|CRITICAL"
  },
  "aisrf_citation": "AI-SRF Proposal, Sikazwe, 2026"
}""",
        2: """{
  "agent": "The Induna",
  "stage": 2,
  "socratic_questions": [{"q_number": 1, "dimension": "root_cause|structural|financial|truth", "question": "[text]"}],
  "cqo_governing_question": "[text]",
  "aisrf_citation": "AI-SRF Proposal, Sikazwe, 2026"
}""",
        3: """{
  "agent": "The Auditor",
  "stage": 3,
  "digital_gauntlet": {"score": [n/10], "conditions": [{"id": [n], "status": "PASSED|FAILED", "evidence": "[text]"}]},
  "financial_exposure_rm": [number],
  "compliance_verdict": "COMPLIANT|NON_COMPLIANT",
  "aisrf_citation": "AI-SRF Proposal, Sikazwe, 2026"
}""",
        4: """{
  "agent": "The Innovator",
  "stage": 4,
  "strategic_options": [{"name": "[text]", "ror_projection": {"recovery_pct": [n], "ror_delta_rm": [n]}, "board_deliverable": "[text]"}],
  "aisrf_citation": "AI-SRF Proposal, Sikazwe, 2026"
}""",
        5: """{
  "agent": "The Challenger",
  "stage": 5,
  "stress_test": {"failure_mode": "[text]", "probability": "H|M|L", "impact_rm": [n], "asy_check": {"score": "[X/Y]", "regulations_cited": [n]}},
  "verdict": "PROCEED|MODIFY|RECONSIDER",
  "aisrf_citation": "AI-SRF Proposal, Sikazwe, 2026"
}""",
        6: """{
  "agent": "The Architect",
  "stage": 6,
  "execution_plan": {"track_a_behavioural": {"action": "[text]", "monday_morning": "[text]"}, "track_b_structural": [{"workstream": "[text]", "budget_rm": [n]}], "board_narrative": "[text]"},
  "iar_score": {"operational": [n], "total": 7, "pct": [n]},
  "aisrf_citation": "AI-SRF Proposal, Sikazwe, 2026"
}""",
        7: """{
  "agent": "The Guardian",
  "stage": 7,
  "monitoring": {"leading_indicators": [{"indicator": "[text]", "target": "[text]"}], "escalation_trigger": "[text]"},
  "final_ror": {"dlr_pct": [n], "decision_alpha": [n], "asy_pct": [n]},
  "ai_system_card": {"king_iv_compliant": true, "reasoning_hash": "[hash]"},
  "aisrf_citation": "AI-SRF Proposal, Sikazwe, 2026"
}"""
    }

    base_prompts = {
        1: f"You are The Tracker — AI-SRF Layer 1 Monitor. Deliver the Environmental Brief and Silicon Sampling (Sikazwe, 2026). MANDATORY: Every macro signal must include its institutional 'source' as provided in the ENVIRONMENTAL DATA injection. Use JSON matching: {schemas[1]}",
        2: f"You are The Induna — AI-SRF Diagnostic Partner. Expose root causes via 4 questions and the CQO Governing Question. Use JSON matching: {schemas[2]}",
        3: f"You are The Auditor — AI-SRF Forensic Analyst. Score the Digital Gauntlet (10 points) and quantify financial exposure. Use JSON matching: {schemas[3]}",
        4: f"You are The Innovator — AI-SRF Creative Catalyst. Present 3 options with ROR Projection Tables. Use JSON matching: {schemas[4]}",
        5: f"You are The Challenger — AI-SRF Devil's Advocate. Run the stress test and provide the ASY check. Use JSON matching: {schemas[5]}",
        6: f"You are The Architect — AI-SRF Implementation Scaffolding. Build Track A/B and the 90-Day Sprint. Use JSON matching: {schemas[6]}",
        7: f"You are The Guardian — AI-SRF Monitoring Agent. Generate the Escalation Ladder and the AI System Card (King IV). Use JSON matching: {schemas[7]}"
    }

    agent_role = base_prompts.get(stage, base_prompts[1])
    
    prompt = f"""
{WRITING_STANDARD}
{NEW_CONSTRUCTS_BLOCK}
{env_context}

{session_context}

{agent_role}

MANDATORY: Return valid JSON only. No prose. No markdown.
"""
    return prompt
