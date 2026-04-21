# Regression Test Suite

The governance regression suite has two layers.

## Python local adapters

Run:

```powershell
python -m pytest tests/ -q -p no:cacheprovider
```

This validates the local FastAPI/Streamlit-adjacent Python components, including agent registry loading, policy enforcement, JSON case state, audit replay, approval gates, handoffs, and synthetic case progression.

## Cloudflare production modules

Run:

```powershell
npm run test:worker
```

This uses Node's built-in test runner and deterministic mocks for Cloudflare D1, KV, R2, and Workers AI. It does not require internet access or a Cloudflare account.

It validates the Cloudflare production architecture: stateful decision loop execution, event emission, policy-governed tool calls, debate queue routing, consensus tracking, replay, and mockable D1/KV/R2 boundaries.

## Current Failing Tests

No known failing tests after the current pass.

If failures appear later, likely fixes are:

- Registry failures: update `config/agents.json` and `config/agents.yaml` together.
- Policy failures: align `packages/policy/policy-engine.js` with the agent tool allowlists.
- D1 replay failures: preserve chronological ordering by `timestamp` in audit queries.
- Monitoring re-trigger failures: keep Monitoring Agent re-entry explicit and audit logged.
- Decision loop failures: ensure `/api/loop` uses `DecisionLoop`, not the compatibility stage adapter.
- Cloudflare compatibility failures: keep production code in `apps/worker` free of FastAPI, Streamlit, filesystem, or long-running server assumptions.
