
import os
import asyncio
from backend.model_client import ModelClient
from backend.rag_engine import RAGEngine

async def test():
    print("Testing RAGEngine initialization...")
    try:
        rag = RAGEngine()
        print("RAGEngine initialized.")
    except Exception as e:
        print(f"RAGEngine failed: {e}")
        return

    print("Testing ModelClient initialization...")
    try:
        client = ModelClient()
        print(f"ModelClient initialized. Provider: {client.provider}")
    except Exception as e:
        print(f"ModelClient failed: {e}")
        return

    print("Testing ModelClient connectivity (ollama)...")
    try:
        # Mock system prompt and message
        res = await client.complete("You are a helpful assistant.", [{"role": "user", "content": "Hello"}], "Fallback")
        print(f"Model response: {res}")
    except Exception as e:
        print(f"Model connectivity failed: {e}")

if __name__ == "__main__":
    asyncio.run(test())
