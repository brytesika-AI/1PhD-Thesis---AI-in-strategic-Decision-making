# FastAPI Local Adapter

Local development entrypoint:

```powershell
uvicorn app.api.main:app --reload --port 8000
```

Production API traffic should use `apps/worker` on Cloudflare Workers.
