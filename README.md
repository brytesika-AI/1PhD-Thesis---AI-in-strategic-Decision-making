# AI_SRF Strategic Decision Operating System

AI_SRF is a Cloudflare-native, multi-agent strategic decision operating system for board-level and executive decision support. It is designed for high-risk organizational decisions where infrastructure volatility, regulatory obligations, operational constraints, and strategic uncertainty must be reasoned about through auditable tools rather than free-form agent text.

The system combines tool-based agents, strategic framework selection and blending, simulation, a digital twin, shared organizational memory, procedural learning, and a strategic narrative generator. Its primary production runtime is Cloudflare Workers, Cloudflare D1, Cloudflare KV, and Cloudflare Pages.

## 1. Project Overview

AI_SRF helps an organization move from case-level reasoning to organization-level intelligence. A governed decision run can:

- Retrieve organization-scoped memory before agents reason.
- Select the best strategic frameworks for the case.
- Run framework tools such as SWOT, PESTLE, Porter's Five Forces, Value Chain Analysis, and Scenario Planning.
- Blend framework outputs into prioritized risks, opportunities, constraints, tradeoffs, and recommended strategy.
- Update and use a digital twin of organizational and environmental conditions.
- Simulate decisions before execution.
- Enforce policy, consensus, and human approval gates.
- Store memory and learning after each run.
- Generate an executive narrative for boardroom communication.

Core capabilities:

- Tool-based agents with per-agent tool allowlists.
- Automatic framework selection and hybrid framework blending.
- Simulation engine with best, worst, and realistic scenarios.
- Digital twin state for environment, operations, risk, and decision feedback.
- Organization-scoped memory and learning logs.
- Safe JSON enforcement and schema validation for tool outputs.
- Narrative generator using Pyramid Principle and Situation-Complication-Resolution.
- D1-backed audit replay and event streaming.

## 2. Architecture

Primary decision flow:

```text
Digital Twin -> Framework Selector -> Framework Blender -> Simulation -> Decision Loop -> Narrative
```

Expanded runtime flow:

```text
Cloudflare Pages UI
  -> Cloudflare Worker API
  -> D1 case state and audit log
  -> Digital Twin load
  -> Shared Memory retrieval
  -> Framework selection
  -> Framework tool execution
  -> Framework blending
  -> Multi-agent decision loop
  -> Simulation before final decision
  -> Policy and consensus validation
  -> Memory and learning persistence
  -> Strategic narrative generation
```

Agent sequence:

```text
Environmental Monitor
-> Socratic Partner
-> Forensic Analyst
-> Creative Catalyst
-> Devil's Advocate
-> Implementation Scaffolding
-> Monitoring Agent
-> Policy Sentinel
-> Consensus Tracker
```

The Worker emits auditable events for agent start/end, tool calls, tool results, framework selection, simulation completion, memory writes, narrative generation, policy violations, loop stops, and system errors.

## 3. Key Components

Important folders:

- `packages/loop/`
  - Stateful decision loop, stage transitions, queues, tool orchestration, failure handling, simulation gating, and final decision readiness.

- `packages/skills/`
  - Tool implementations used by agents. Includes `gather_evidence`, assumptions extraction, framework tools, option generation, objections, stress tests, implementation plans, monitoring rules, memory extraction, learning extraction, and simulation tools.

- `packages/memory/`
  - D1-backed organizational memory, including episodic, semantic, procedural, organization-level memory, agent learning logs, retrieval ranking, and organizational intelligence output.

- `packages/frameworks/`
  - Framework selector and framework blender. Selects relevant strategic frameworks, normalizes outputs, ranks risks/opportunities, identifies conflicts, and synthesizes a blended strategy.

- `packages/simulation/`
  - Simulation engine. Generates scenarios, applies them to digital twin and framework state, runs mini decision loops, evaluates outcomes, and chooses the best strategy.

- `packages/digital-twin/`
  - Digital twin engine. Ingests load shedding, market, system, and regulatory data; computes risk state; persists twin state; feeds simulation and decision loops.

- `packages/narrative/`
  - Strategic narrative generator. Converts structured analysis into executive summary, SCR narrative, insights, risks, tradeoffs, recommendation, implementation story, and confidence.

- `utils/`
  - Shared infrastructure utilities, including JSON enforcement, schema validation, safe tool execution, and structured tool failure handling.

- `apps/worker/`
  - Cloudflare Worker API, authentication, D1 schema, CORS, command endpoints, scheduled digital twin updates, and production orchestration.

- `apps/web/`
  - Cloudflare Pages frontend with panels for digital twin status, organizational intelligence, strategic analysis, framework selection, blended strategy, simulation results, and executive narrative.

## 4. How to Run

Install dependencies:

```powershell
npm install
```

Run tests:

```powershell
npm run test:all
python -m pytest tests\test_cloudflare_architecture.py
```

Run Worker syntax check:

```powershell
npm run check:worker
```

Apply D1 schema:

```powershell
npm run d1:migrate
```

Deploy Worker:

```powershell
npm run deploy:worker
```

Deploy frontend:

```powershell
npm run deploy:pages
```

Production URLs:

- Web UI: <https://ai-srf-cloudflare.pages.dev>
- Worker API: <https://ai-srf-governance-worker.bryte-sika.workers.dev>

Test login:

- Email: `analyst@board.example`
- Role: `analyst`
- Organization ID: `board-alpha`
- Organization Name: `Board Alpha`
- Access Passcode: `ai-srf-dev`

Useful scenario:

```text
Cloud migration with load shedding + POPIA risk
```

Recommended UI flow:

1. Login as analyst.
2. Enter the scenario in Decision Case.
3. Click `Run Simulation Before Decision`.
4. Click `Run Governed Decision Cycle`.
5. Review Digital Twin Status, Framework Selection, Strategic Analysis, Blended Strategy, Simulation Results, Organizational Intelligence, and Executive Narrative.

## 5. Known Issues

- Cloudflare KV keys are limited to 512 bytes.
  - Never use JSON or full state payloads as KV keys.
  - Store JSON as the value.
  - Use short keys such as `case:<case_id>`, `evidence:<case_id>`, or `memory:<org_id>:<type>:<short_id>`.

- D1 table dependencies must exist before production decision runs.
  - Required tables include `decision_cases`, `audit_events`, `digital_twin_state`, `organization_memory`, `agent_learning_log`, `episodic_memory`, `semantic_memory`, and `procedural_memory`.
  - Run `npm run d1:migrate` after schema changes.

- Tool outputs must be valid JSON objects.
  - LLM output must pass `enforceJSON()`.
  - Tool outputs must pass schema validation.
  - Invalid JSON, empty outputs, and stringified objects such as `[object Object]` are handled through retry/fallback logic.

- Critical tool failures stop the loop.
  - Infrastructure failures such as KV key overflow or missing D1 tables should not re-enqueue degraded agent turns indefinitely.
  - The loop records `CRITICAL TOOL FAILURE` and stops.

- Simulation risk gates can require human approval.
  - A live run may stop at `human_approval_required`; this is expected governance behavior, not a system fault.

## 6. Future Roadmap

- Autonomous execution for pre-approved low-risk actions.
- Streaming agent progress and live trace panels.
- More advanced optimization for strategy selection and portfolio-level decision scheduling.
- Richer digital twin integrations with real external infrastructure, market, regulatory, and operational data.
- Model evaluation harness for framework quality, narrative quality, and decision outcome quality.
- Longitudinal organizational learning dashboards.

## Development Notes

Main test suites:

```powershell
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:worker
npm run test:all
```

Key production commands:

```powershell
npm run d1:migrate
npm run deploy:worker
npm run deploy:pages
```

Authentication is handled by the Worker. The Pages workspace posts to `/api/auth/login`, receives a secure JWT cookie, and then calls protected routes with credentials included. Case state, replay, memory, and digital twin data are scoped by `organization_id`.

## Author

Bright Sikazwe  
PhD Candidate, AI in Strategic Decision Making
