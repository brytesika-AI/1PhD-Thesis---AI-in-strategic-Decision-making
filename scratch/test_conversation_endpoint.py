
import httpx
import json

def test_conversation():
    url = "http://localhost:8000/api/conversation"
    payload = {
        "messages": [{"role": "user", "content": "Test decision: Cloud migration under POPIA"}],
        "stage": 1,
        "risk_state": "ELEVATED",
        "run_id": "test-run",
        "sector": "financial_services"
    }
    print(f"Sending request to {url}...")
    try:
        with httpx.Client(timeout=60.0) as client:
            res = client.post(url, json=payload)
            print(f"Status Code: {res.status_code}")
            print(f"Response: {res.text}")
    except Exception as e:
        print(f"Request failed: {e}")

if __name__ == "__main__":
    test_conversation()
