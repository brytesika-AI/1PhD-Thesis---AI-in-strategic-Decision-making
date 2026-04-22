# Cloudflare-First AI-SRF Architecture

Production target: Cloudflare.

AI-SRF is an enterprise strategic decision platform, not a consumer assistant. Production runtime components are designed around Cloudflare Workers, Cloudflare Pages, D1, KV, and R2-compatible boundaries. Python FastAPI and Streamlit remain local development adapters for research iteration and offline testing.

## Translated OpenClaw-Inspired Ideas

AI-SRF borrows architectural discipline, not product shape:

- Gateway as control plane: `apps/worker` owns routing, policy checks, state transitions, audit writes, and approval gates.
- Explicit multi-agent routing: the seven-stage AI-SRF sequence is config-driven and dynamic stage skipping is disabled.
- Modular skills: skills are callable only through the policy-governed skill interface.
- Config-driven runtime behavior: `config/agents.json` defines agents and `config/runtime.json` defines Cloudflare storage, sandbox, hooks, routing, and memory posture.
- Controlled tool and sandbox policy: tools are blocked by default; shell, filesystem writes, email send, external post, and unreviewed scraping are production-blocked.
- Stateful sessions and memory discipline: state is case-bounded in D1, organisation memory belongs in KV/R2 only through explicit adapters, and cross-organisation memory mixing is forbidden.
- Event-driven hooks and monitoring: stage completion, approval decisions, and scheduled monitoring ticks emit hookable events.
- Visible workspaces: `apps/web` exposes panels for briefing, evidence, assumptions, options, stress tests, roadmap, monitoring, and audit trace.
- Stateful loop runtime: `packages/loop/decision-loop.js` implements the Agent -> loop -> tool execution -> state update -> event emission -> next action pattern.
- Steering, follow-up, and debate queues: `packages/loop/queues.js` separates interrupting guidance, normal next actions, and challenge/rebuttal work.

Consumer assistant traits are intentionally excluded: no broad messaging-channel sprawl, no personal-assistant persona, and no autonomous task execution outside human approval gates.

## Runtime Split

Cloudflare production path:

- `apps/worker/`: Cloudflare Worker orchestration gateway.
- `apps/web/`: Cloudflare Pages strategic workspace.
- `packages/core/`: Worker-safe orchestration gateway.
- `packages/loop/`: Stateful decision loop and queue control.
- `packages/events/`: Structured event bus persisted through D1 audit events.
- `packages/agents/`: Worker-safe agent registry facade backed by `config/agents.json`.
- `packages/shared/`: shared registry helpers and pipeline ordering.
- `packages/skills/`: controlled, deterministic skill invocation.
- `packages/policy/`: blocked-by-default tool governance and upload/external access checks.
- `packages/state/`: D1 case-state persistence.
- `packages/audit/`: D1 audit logging and replay.

Local development path:

- `app/api/`: FastAPI adapter for local simulation.
- `app/ui/`: Streamlit local workspace.
- `app/core/`, `app/agents/`, `app/skills/`, `app/policy/`, `app/state/`, `app/audit/`: Python equivalents used by tests and research workflows.
- `workspace/`: ignored local JSON state and audit traces.

## Cloudflare Storage Choices

- D1 stores structured decision cases and audit events. It is the production source of truth for replayable governance records.
- KV stores lightweight runtime configuration, monitoring ticks, and fast organisation memory lookups where eventual consistency is acceptable.
- R2 is reserved for large evidence bundles, board-pack exports, or uploaded artefacts that should not be packed into D1 rows.
- Durable Objects are not mandatory yet. They should be introduced only if live case locking, multi-user cursor state, or concurrent session coordination becomes a real production requirement.

## Orchestration Gateway

The Worker gateway exposes:

- `GET /health`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/agents`
- `POST /api/policy/check`
- `GET /api/cases`
- `POST /api/orchestrate`
- `POST /api/loop`
- `GET /api/tools`
- `GET /api/cases/{case_id}/replay`
- `GET /api/cases/{case_id}/events`
- `POST /api/cases/{case_id}/approvals/{approval_id}`

`POST /api/loop` is the production decision engine. It selects the next agent, executes schema-bearing tools through `beforeToolCall` and `afterToolCall` policy hooks, emits events, persists state, enqueues debate/follow-up work, checks consensus, and stops only on decision reached, escalation required, no progress, or max iterations.

`GET /api/cases/{case_id}/events` returns persisted case events as JSON by default and as a replayable `text/event-stream` response when requested with an SSE accept header.

`POST /api/orchestrate` remains as a compatibility adapter for incremental migration.

Every action emits structured D1-backed events such as `agent_start`, `agent_end`, `queue_enqueued`, `queue_dequeued`, `tool_execution_start`, `tool_execution_end`, `objection_raised`, `rebuttal_added`, `consensus_updated`, `policy_violation_detected`, `loop_stopped`, and `case_closed`.

The preserved sequence is:

Environmental Monitor -> Socratic Partner -> Forensic Analyst -> Creative Catalyst -> Devil's Advocate -> Implementation Scaffolding -> Monitoring Agent.

Control agents sit outside the linear stage list:

- Decision Governor selects next action and stop conditions.
- Consensus Tracker preserves agreement, disagreement, confidence, and unresolved tensions.
- Policy Sentinel validates tool calls and final decision readiness.

Final decision readiness requires Devil's Advocate, Monitoring Agent, Policy Sentinel, and Consensus Tracker validation. The Monitoring Agent must produce monitoring rules before the final policy and consensus checks run.

## Authentication and Tenancy

API routes are protected by either Cloudflare Access identity headers or the Worker JWT login flow. JWT login creates a signed `ai_srf_session` cookie and returns a user object with `user_id`, `email`, `role`, `organization_id`, and `organization_name`.

Every case stores `created_by`, `last_modified_by`, `organization_id`, and `organization_name` in structured D1 payload state. Case listing, replay, and event reads are organization-filtered before data leaves the Worker. Audit event payloads include `user_id`, `action`, `timestamp`, and `agent` for governance traceability.

Role gates:

- analyst: run cases.
- executive: view cases and approve or reject decisions.
- admin: manage system and policy routes.

## Deployment Flow

Apply D1 schema:

```powershell
npm run d1:migrate
```

Deploy Worker:

```powershell
npm run deploy:worker
```

Deploy Pages:

```powershell
npm run deploy:pages
```

Set secrets through Wrangler rather than committing them:

```powershell
wrangler secret put NEWSAPI_KEY --config apps/worker/wrangler.toml
```

## Local Run Flow

```powershell
pip install -r requirements.txt
uvicorn app.api.main:app --reload --port 8000
streamlit run app/ui/main.py
python -m pytest tests/ -q -p no:cacheprovider
```

Local JSON state is written under `workspace/`. Production state is written to Cloudflare D1.

## Isolated Local-Only Capabilities

- FastAPI and Streamlit are development adapters only.
- Chroma/local vector indexes are research conveniences unless replaced by Vectorize or R2-backed artefact retrieval.
- Direct filesystem state is local-only and must not be used as a production persistence assumption.
- Any Python model bridge must sit behind an adapter boundary. The Cloudflare Worker remains the production orchestration path.
