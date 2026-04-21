"""Test Currents API with the provided key."""
import httpx, json

API_KEY = "4d0089dc-5880-4bb5-9d20-e8361f6f00cc"

# Try Currents API (uses UUID-format keys)
print("=== Testing Currents API ===")
try:
    r = httpx.get(f"https://api.currentsapi.services/v1/search?keywords=South+Africa&language=en&apiKey={API_KEY}", timeout=15)
    print(f"Status: {r.status_code}")
    d = r.json()
    if r.status_code == 200 and d.get("status") == "ok":
        print(f"Articles found!")
        for a in d.get("news", [])[:5]:
            print(f"  [{a.get('category', ['?'])[0] if a.get('category') else '?'}] {a.get('title', '?')[:80]}")
            print(f"    Source: {a.get('author', '?')}")
    else:
        print(json.dumps(d, indent=2)[:300])
except Exception as e:
    print(f"Error: {e}")
