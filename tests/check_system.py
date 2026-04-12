import httpx
import json
import time
import sys

# Configure backend URL - check common ports
BASE_URLS = ["http://localhost:8000", "http://localhost:8001"]

def get_base_url():
    for url in BASE_URLS:
        try:
            r = httpx.get(f"{url}/health", timeout=2.0)
            if r.status_code == 200:
                return url
        except:
            continue
    return None

def test_system():
    url = get_base_url()
    if not url:
        print("❌ Error: Backend is not running on port 8000 or 8001.")
        print("👉 Please start the backend with: uvicorn backend.main:app --port 8000")
        sys.exit(1)

    print(f"--- Found active backend at {url}")
    
    print("\n[CHECK] Testing Backend Health...")
    r = httpx.get(f"{url}/health")
    health = r.json()
    print(f"[OK] Status: {health.get('status')}")
    print(f"[INFO] Model: {health.get('model', {}).get('model', 'Unknown')}")
    print(f"[INFO] RAG Docs Indexed: {health.get('rag_docs', 0)}")

    print("\n[CHECK] Testing Agent Reasoning (Stage 1)...")
    payload = {
        "messages": [{"role": "user", "content": "How does POPIA affect our cloud migration strategy in South Africa?"}],
        "stage": 1,
        "risk_state": "ELEVATED",
        "sector": "financial_services",
        "run_id": f"test-{int(time.time())}"
    }
    
    try:
        start_time = time.time()
        r = httpx.post(f"{url}/api/conversation", json=payload, timeout=60.0)
        duration = time.time() - start_time
        
        if r.status_code == 200:
            print(f"[OK] Success (took {duration:.2f}s)")
            content = r.json().get("content")
            print("\n[AGENT OUTPUT]:")
            print(json.dumps(content, indent=2))
        else:
            print(f"[ERROR] {r.status_code}: {r.text}")
    except Exception as e:
        print(f"[ERROR] Conversation failed: {e}")

if __name__ == "__main__":
    test_system()
