# AI-SRF Cloudflare Pages Workspace

This is the production-facing Pages-compatible strategic workspace. It calls the Cloudflare Worker orchestration gateway and does not require Streamlit, FastAPI, or a long-running server.

Deploy:

```powershell
wrangler pages deploy apps/web --project-name ai-srf-cloudflare --branch main
```
