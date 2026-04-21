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

### V4.1 Strategic Decision Operating System
The core application has been refactored into an enterprise-grade governance platform with the following domain separation:
- **Production target: Cloudflare.** Deployable runtime components should assume Cloudflare Workers for APIs/orchestration and Cloudflare Pages for the frontend.
- **`apps/worker/`**: Cloudflare Worker production API and orchestration gateway using D1-backed case state and audit replay.
- **`apps/web/`**: Cloudflare Pages-compatible panel workspace for production use.
- **`packages/loop/`**: Stateful decision loop and steering/follow-up/debate queues.
- **`packages/events/`**: Structured event bus persisted via D1 audit events.
- **`packages/`**: Worker-safe modules for agents, registry loading, policy, controlled tools/skills, D1 state, D1 audit, debate, consensus, and orchestration.
- **`config/runtime.json`**: Cloudflare-first runtime controls for gateway mode, stateful loop mode, queues, debate, sandbox policy, storage targets, memory discipline, and event hooks.
- **`app/api/`**: The FastAPI endpoints that connect the Streamlit UI to the backend orchestration.
- **`app/core/`**: The central *Orchestration Gateway* which reads agent configs and handles step-by-step LLM transitions.
- **`app/agents/`**: Declarative registry loader pointing to `config/agents.yaml`, plus structured output validation.
- **`app/skills/`**: Modular controlled skills for SWOT, Five Whys, RCA, compliance, scenarios, resilience scoring, and implementation plans.
- **`app/policy/`**: Policy engine enforcing blocked-by-default tools, per-agent tool allowlists, upload safety, external access controls, and approval gates.
- **`app/state/`**: Pydantic structured decision-case state stored as local JSON.
- **`app/audit/`**: JSONL audit traces for agent execution, tool invocation, policy checks, human approval status, and replay.
- **`app/ui/`**: Streamlit strategic workspace for local development with panels for briefing, evidence, assumptions, options, stress tests, roadmap, monitoring, and audit trace.

The governed AI-SRF sequence is preserved:
Environmental Monitor -> Socratic Partner -> Forensic Analyst -> Creative Catalyst -> Devil's Advocate -> Implementation Scaffolding -> Monitoring Agent.

The operating system adds three control agents:
Decision Governor -> Consensus Tracker -> Policy Sentinel.

Human-in-the-loop control is enforced as a first-class approval gate. Stages marked `requires_human_approval` in `config/agents.yaml` persist a pending approval record after execution. The orchestrator blocks downstream stages until the gate is approved through the workspace or `POST /api/runs/{case_id}/approvals/{approval_id}`.

The strongest OpenClaw-style architectural ideas are translated into an enterprise governance platform: the gateway is the control plane, routing is explicit, skills are modular and policy-mediated, runtime behavior is config-driven, sessions are stateful but case-bounded, monitoring is event-hooked, and reasoning is surfaced through visible workspaces. The pi-agent-style runtime is implemented as an Agent -> decision loop -> tool execution -> state update -> event emission -> next action cycle with steering, follow-up, and debate queues. AI-SRF deliberately does not copy consumer assistant messaging sprawl or personal-assistant persona patterns.

### Sample Local Case Flow
1. Start the API: `uvicorn app.api.main:app --reload --port 8000`.
2. Start the workspace: `streamlit run app/ui/main.py`.
3. Enter a decision-case goal in the active stage panel.
4. Approve or reject each mandatory human review gate before moving downstream.
5. Inspect persisted case state under `workspace/cases`.
6. Replay the audit trail through `GET /api/runs/{case_id}/replay` or the workspace audit panel.

### Sample Cloudflare Deployment Flow
Cloudflare is the default production assumption.
1. Apply D1 tables: `npm run d1:migrate`.
2. Deploy the Worker API: `npm run deploy:worker`.
3. Deploy the Pages workspace: `npm run deploy:pages`.
4. Store external API keys as Cloudflare secrets, for example: `wrangler secret put NEWSAPI_KEY --config apps/worker/wrangler.toml`.

Production state and audit records use Cloudflare D1. KV is used for lightweight runtime/config lookup, and R2 is reserved for large evidence bundles or exported artefacts. FastAPI, Streamlit, local JSON state, and local vector indexes are development adapters only.

Production loop entrypoint: `POST /api/loop`.
Compatibility stage adapter: `POST /api/orchestrate`.

See `docs/CLOUDFLARE_FIRST_ARCHITECTURE.md` for the full Cloudflare-first runtime split and tradeoffs.

### Regression Tests
Run the regression tests inside your python environment via:
```bash
python -m pytest tests/ -q -p no:cacheprovider
npm run test:worker
```

### Author
**Bright Sikazwe**  
PhD Candidate · April 2026
