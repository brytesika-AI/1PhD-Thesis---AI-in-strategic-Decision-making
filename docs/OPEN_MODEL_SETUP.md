# AI-SRF: Local Open-Model Setup Guide

This guide explains how to run the AI-SRF framework using local, open-source models to ensure **Algorithmic Sovereignty** and **Infrastructure Autonomy**.

## 1. Prerequisites
- **Ollama**: Download and install from [ollama.com](https://ollama.com).
- **Python 3.10+**: Ensure `pip` is available.

## 2. Model Installation
The AI-SRF is optimized for Llama 3.1. Open your terminal and run:
```bash
ollama pull llama3.1:latest
ollama pull nomic-embed-text:latest
```

## 3. Environment Configuration
Create a `.env` file in the root directory:
```bash
MODEL_PROVIDER=ollama
MODEL_NAME=llama3.1:latest
OLLAMA_BASE_URL=http://localhost:11434
```

## 4. Why Open Models?
- **Privacy**: No organizational strategy or RAG data leaves your local machine.
- **Resilience**: Operates without an internet connection (Stage 6).
- **Auditability**: Reasoning traces are generated and stored locally.
