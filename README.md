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
3. **Run**:
   - Start backend: `uvicorn backend.main:app --reload --port 8000`.
   - Start frontend: `streamlit run app/main.py`.

### Author
**Bright Sikazwe**  
PhD Candidate · April 2026
