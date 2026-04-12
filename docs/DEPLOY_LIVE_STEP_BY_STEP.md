# Deploy AI-SRF Live: Step-by-Step

## Phase 1: Local Deployment (Research Benchmarking)
1. Install Ollama and pull models.
2. Clone repository and install requirements.
3. Run backend and frontend locally.

## Phase 2: Private Cloud (Streamlit + FastAPI)
1. **Containerization**: Use the provided (optional) Docker configurations.
2. **Reverse Proxy**: Setup Nginx or Caddy for HTTPS.
3. **Environment**: Ensure `ANTHROPIC_API_KEY` is set if using hybrid mode; otherwise, point `OLLAMA_BASE_URL` to your private Ollama server.

## Phase 3: Research Validation (Delphi)
1. Export the Silicon Sampling run results.
2. Share the summary dashboard via a hosted Streamlit URL (Streamlit Community Cloud or private).
3. Record reasoning traces for the PhD thesis results chapter.
