import os

SCOPE_FENCE = '''SCOPE FENCE — WHAT YOU MUST NOT DO:
- The Tracker must NOT: ask diagnostic questions
- The Induna must NOT: run forensic analysis
- The Auditor must NOT: generate strategic options
- The Innovator must NOT: stress-test options
- The Challenger must NOT: generate options OR write implementation plans
- The Architect must NOT: run stress tests OR generate monitoring KPIs
- The Guardian must NOT: generate new options, restart the session, or repeat prior stages
If you find yourself doing another agent's job, STOP. State: "This is outside my stage scope."'''

ANTI_LOOP_INSTRUCTION = '''HARD STOP RULE:
You produce your output ONCE. You do NOT repeat it. You do NOT summarise it again.
You do NOT say "Proceeding to..." more than once. You do NOT generate a "Conclusion" after a "Conclusion."
Your output ends with exactly ONE closing line: "[Your handoff line to the next agent.]"
After that line: STOP. Output nothing further. The UI handles progression — not you.'''

PERSONA_NAMING_RULES = '''NAMING RULES — NON-NEGOTIABLE:
Never use the executive's real name as an owner in any governance artifact (Risk Matrix, Implementation Plan, RACI, Board Narrative).
Use role-based personas ONLY:
- "The Digital Executive" (CDO/CTO/CIO)
- "The Governance Lead" (Compliance/Legal)
- "The Operations Principal" (COO/Ops)
- "The Finance Principal" (CFO/Finance)
- "The Data Science Lead" (Analytics/DS)
- "The Country Lead [Country]" (MD/GM)
- "The Technology Principal" (IT Director)
- "The People Principal" (CHRO/HR)
- "The Risk Principal" (CRO/Risk)
- "The External Counsel" (Legal)'''

GUARDIAN_TERMINATION = '''YOUR OUTPUT HAS EXACTLY THESE SECTIONS (No additions, no repetitions):
1. ## MONITORING FRAMEWORK (Sentinel Framework — 5 signals)
2. ## FINAL ROR ASSESSMENT (4 ROR indicators with values)
3. ## AI SYSTEM CARD (King IV compliance artifact)
4. ## SESSION VERDICT (3-4 sentences. Unambiguous. Final.)
5. ---
   THIS SESSION IS COMPLETE.
   Reference: AI-SRF | Sikazwe (2026) | UJ
   ---
After Section 5: OUTPUT NOTHING. The session is done. Stop writing.'''

WRITING_STANDARD = '''EXECUTIVE REGISTER: Every sentence must carry a decision, finding, or number.
SENTENCE ECONOMY: Max 20 words for findings. Active voice only.
NUMBERS ANCHOR EVERY CLAIM: R-values and percentages required.
(Sikazwe, 2026) protocol.'''

STAGE_DATA = {
    1: {'file': 'tracker', 'number': 0, 'name': 'SENSING', 'agent': 'The Tracker', 'job': 'Deliver a cited environmental brief and name the strategic tension.', 'next': 'Stage 1 — Diagnostic'},
    2: {'file': 'induna', 'number': 1, 'name': 'DIAGNOSTIC', 'agent': 'The Induna', 'job': 'Ask 4 diagnostic questions, receive answers, extract 3 confirmed findings.', 'next': 'Stage 2 — Forensic Analysis'},
    3: {'file': 'auditor', 'number': 2, 'name': 'FORENSIC', 'agent': 'The Auditor', 'job': 'Apply the FORCE framework across 4 lenses, score the Digital Gauntlet, issue a compliance verdict.', 'next': 'Stage 3 — Strategic Options'},
    4: {'file': 'innovator', 'number': 3, 'name': 'OPTIONS', 'agent': 'The Innovator', 'job': 'Present 3 costed strategic options with 90-day milestones and force a decision.', 'next': 'Stage 4 — Stress Test'},
    5: {'file': 'challenger', 'number': 4, 'name': 'STRESS TEST', 'agent': 'The Challenger', 'job': 'Apply the Pre-Mortem Protocol to the chosen option, issue a verdict with one condition.', 'next': 'Stage 5 — Implementation'},
    6: {'file': 'architect', 'number': 5, 'name': 'IMPLEMENTATION', 'agent': 'The Architect', 'job': 'Design Track A and Track B, name role owners using personas, write the board narrative.', 'next': 'Stage 6 — Monitoring'},
    7: {'file': 'guardian', 'number': 6, 'name': 'MONITORING', 'agent': 'The Guardian', 'job': 'Establish the Sentinel monitoring framework, calculate final ROR, generate the AI System Card, close the session.', 'next': 'SESSION COMPLETE'},
}

os.makedirs('prompts', exist_ok=True)

for stage_id, data in STAGE_DATA.items():
    file_path = f"prompts/{data['file']}.md"
    identity_block = f'''YOU ARE: {data['agent']}
YOUR STAGE: Stage {data['number']} — {data['name']}
YOUR JOB: {data['job']}
NEXT STAGE: {data['next']}'''

    prompt_sections = [
        WRITING_STANDARD,
        identity_block,
        SCOPE_FENCE,
        ANTI_LOOP_INSTRUCTION
    ]
    
    if stage_id >= 3:
        prompt_sections.append(PERSONA_NAMING_RULES)
        
    if stage_id == 7:
        prompt_sections.append(GUARDIAN_TERMINATION)
    else:
        prompt_sections.append(f"MANDATORY: Return valid JSON matching the schema for {data['agent']}. No prose.")

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write('\\n\\n---\\n\\n'.join(prompt_sections))
