from __future__ import annotations

import os
from typing import Any, Dict, List

import httpx


class ModelClient:
    """Open-model-first provider router.

    Supported providers:
    - ollama (local open models)
    - huggingface_inference (HF Inference API)
    - github_models (GitHub Models OpenAI-compatible endpoint)
    - openai_compatible (generic OpenAI-compatible endpoint)
    """

    def __init__(self) -> None:
        self.provider = os.getenv("MODEL_PROVIDER", "ollama").lower()
        self.hf_token = os.getenv("HUGGINGFACE_API_KEY")
        self.github_token = os.getenv("GITHUB_MODELS_API_KEY")
        self.openai_key = os.getenv("OPENAI_API_KEY")
        self.model_name = os.getenv("MODEL_NAME")
        self.timeout = float(os.getenv("MODEL_TIMEOUT_SECONDS", "120"))

    def provider_status(self) -> Dict[str, Any]:
        live = False
        if self.provider == "ollama":
            live = True
        elif self.provider == "huggingface_inference" and self.hf_token:
            live = True
        elif self.provider == "github_models" and self.github_token:
            live = True
        elif self.provider == "openai_compatible" and self.openai_key:
            live = True
        return {
            "provider": self.provider,
            "live": live,
            "model": self.model_name or self.default_model(),
            "open_source_first": self.provider in {"ollama", "huggingface_inference", "github_models"},
        }

    def default_model(self) -> str:
        if self.provider == "ollama":
            return "llama3.1:latest"
        if self.provider == "huggingface_inference":
            return "mistralai/Mistral-7B-Instruct-v0.3"
        if self.provider == "github_models":
            return "mistralai/Mistral-7B-Instruct-v0.3"
        return "local-model"

    async def complete(self, system_prompt: str, messages: List[Dict[str, str]], fallback_text: str) -> str:
        try:
            if self.provider == "ollama":
                return await self._ollama_complete(system_prompt, messages)
            if self.provider == "huggingface_inference":
                if not self.hf_token:
                    print("⚠️ Warning: HUGGINGFACE_API_KEY missing. Falling back.")
                    return fallback_text
                return await self._huggingface_inference_complete(system_prompt, messages)
            if self.provider == "github_models":
                if not self.github_token:
                    print("⚠️ Warning: GITHUB_MODELS_API_KEY missing. Falling back.")
                    return fallback_text
                return await self._github_models_complete(system_prompt, messages)
            if self.provider == "openai_compatible":
                return await self._openai_compatible_complete(system_prompt, messages)
        except Exception as e:
            print(f"❌ Model Provider Error ({self.provider}): {e}")
            return fallback_text
        return fallback_text

    async def _ollama_complete(self, system_prompt: str, messages: List[Dict[str, str]]) -> str:
        url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/") + "/api/chat"
        body = {
            "model": self.model_name or self.default_model(),
            "messages": [{"role": "system", "content": system_prompt}] + messages,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.2},
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(url, json=body)
            r.raise_for_status()
            data = r.json()
            return data["message"]["content"].strip()

    async def _huggingface_inference_complete(self, system_prompt: str, messages: List[Dict[str, str]]) -> str:
        model = self.model_name or self.default_model()
        url = f"https://api-inference.huggingface.co/models/{model}"
        headers = {"Authorization": f"Bearer {self.hf_token}"}
        prompt = f"{system_prompt}\n\n" + "\n".join([f"{m['role']}: {m['content']}" for m in messages])
        payload = {
            "inputs": prompt,
            "parameters": {"max_new_tokens": 1500, "temperature": 0.2},
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(url, headers=headers, json=payload)
            r.raise_for_status()
            data = r.json()
            if isinstance(data, list): return data[0].get("generated_text", "").strip()
            return data.get("generated_text", "").strip()

    async def _github_models_complete(self, system_prompt: str, messages: List[Dict[str, str]]) -> str:
        url = "https://models.inference.ai.azure.com/chat/completions"
        headers = {"Authorization": f"Bearer {self.github_token}"}
        body = {
            "model": self.model_name or self.default_model(),
            "messages": [{"role": "system", "content": system_prompt}] + messages,
            "temperature": 0.2,
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(url, headers=headers, json=body)
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"].strip()

    async def _openai_compatible_complete(self, system_prompt: str, messages: List[Dict[str, str]]) -> str:
        url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/") + "/chat/completions"
        headers = {"Authorization": f"Bearer {self.openai_key}"}
        body = {
            "model": self.model_name or "gpt-4o",
            "messages": [{"role": "system", "content": system_prompt}] + messages,
            "temperature": 0.2,
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(url, headers=headers, json=body)
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"].strip()

    async def stream(self, text: str):
        for token in text.split():
            yield token + " "
