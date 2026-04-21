# AI-driven Strategic Resilience Framework (AI-SRF)

## PhD Research Artefact

The AI-SRF is a multi-agent reasoning system designed to close the epistemic gap in South African corporate boards facing compound infrastructure failure and regulatory fragmentation.

### Key Features
- **Open-Model First**: Support for Ollama, Hugging Face, and Generic OpenAI endpoints.
- **Regulation-Grounded RAG**: Integrated South African regulatory context (POPIA, King IV, EEA).
- **Silicon Sampling Engine**: Synthetic stakeholder simulation for pre-validation of strategic options.
- **ROR Indicators**: Real-time tracking of Return on Resilience metrics (DLR, Decision Alpha, IAR, ASY).

### Architecture
1. **Institutional Sensing Layer**: Environmental Monitor Agent.
2. **Context-Conditioned Reasoning Layer**: Socratic Partner, Forensic Analyst, Creative Catalyst, Devil's Advocate.
3. **Socio-Technical Alignment Layer**: Implementation Scaffolding, Monitoring Agent.

### Setup Instructions
1. **Environment**:
   - Clone the repo.
   - Install dependencies: `pip install -r requirements.txt`.
   - Setup `.env` file (see `.env.example`).
2. **Models**:
   - Ensure Ollama is running (`llama3.1:latest` and `nomic-embed-text` recommended).
3. **Run Flow (Local Simulation)**:
   - Start the orchestration API (FastAPI): `uvicorn app.api.main:app --reload --port 8000`
   - Start the strategic workspace (Streamlit): `streamlit run app/ui/main.py`
   - The workspace will persist local JSON trace logs in `workspace/audit_logs` and structured case data in `workspace/cases`.

### V4.0 Governance Architecture
The core application has been refactored into an enterprise-grade governance platform with the following domain separation:
- **`app/api/`**: The FastAPI endpoints that connect the Streamlit UI to the backend orchestration.
- **`app/core/`**: The central *Orchestration Gateway* which reads agent configs and handles step-by-step LLM transitions.
- **`app/agents/`**: Declarative registry loader pointing to `config/agents.yaml`, plus structured output validation.
- **`app/skills/`**: Modular controlled skills for SWOT, Five Whys, RCA, compliance, scenarios, resilience scoring, and implementation plans.
- **`app/policy/`**: Policy engine enforcing blocked-by-default tools, per-agent tool allowlists, upload safety, external access controls, and approval gates.
- **`app/state/`**: Pydantic structured decision-case state stored as local JSON.
- **`app/audit/`**: JSONL audit traces for agent execution, tool invocation, policy checks, human approval status, and replay.
- **`app/ui/`**: Streamlit strategic workspace with panels for briefing, evidence, assumptions, options, stress tests, roadmap, monitoring, and audit trace.

The governed AI-SRF sequence is preserved:
Environmental Monitor -> Socratic Partner -> Forensic Analyst -> Creative Catalyst -> Devil's Advocate -> Implementation Scaffolding -> Monitoring Agent.

Human-in-the-loop control is enforced as a first-class approval gate. Stages marked `requires_human_approval` in `config/agents.yaml` persist a pending approval record after execution. The orchestrator blocks downstream stages until the gate is approved through the workspace or `POST /api/runs/{case_id}/approvals/{approval_id}`.

### Sample Local Case Flow
1. Start the API: `uvicorn app.api.main:app --reload --port 8000`.
2. Start the workspace: `streamlit run app/ui/main.py`.
3. Enter a decision-case goal in the active stage panel.
4. Approve or reject each mandatory human review gate before moving downstream.
5. Inspect persisted case state under `workspace/cases`.
6. Replay the audit trail through `GET /api/runs/{case_id}/replay` or the workspace audit panel.

### Regression Tests
Run the regression tests inside your python environment via:
```bash
python -m pytest tests/ -q -p no:cacheprovider
```

### Author
**Bright Sikazwe**  
PhD Candidate · April 2026
