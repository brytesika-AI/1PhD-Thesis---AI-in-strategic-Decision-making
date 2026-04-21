# Local Development Adapters

Production runs on Cloudflare Workers, Pages, D1, KV, and R2-compatible boundaries.

This folder documents local-only adapters:

- `fastapi/`: references `app/api` for local orchestration experiments.
- `streamlit/`: references `app/ui` for local workspace experiments.

These adapters must not introduce production assumptions that require an always-on Python server.
