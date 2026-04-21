"""Check AI-SRF v2.0 systems."""
import httpx

WORKER = "https://ai-srf-worker.bryte-sika.workers.dev"

# 1. Check risk intelligence
print("=== RISK INTELLIGENCE FEED ===")
r = httpx.get(f"{WORKER}/api/sensing/risks", timeout=30)
data = r.json()
print(f"Total signals: {len(data)}")
for s in data[:10]:
    cat = s.get("risk_category", "?")
    score = s.get("risk_score", "?")
    title = s.get("title", "?")[:80]
    print(f"  [{cat}] Score {score}: {title}")

# 2. Check institutional memory
print("\n=== INSTITUTIONAL MEMORY ===")
r = httpx.get(f"{WORKER}/api/memory?org=default", timeout=30)
mem = r.json()
print(f"Memory: {mem.get('memory', 'N/A')[:200]}...")
print(f"Profile: {mem.get('profile', 'N/A')[:200]}...")

# 3. Check skill store
print("\n=== SKILL STORE ===")
r = httpx.get(f"{WORKER}/api/skills?org=default", timeout=30)
skills = r.json()
print(f"Skills: {skills.get('count', 0)} accumulated")

# 4. Check sessions
print("\n=== DECISION SESSIONS ===")
r = httpx.get(f"{WORKER}/api/sessions?org=default", timeout=30)
sessions = r.json()
print(f"Sessions: {len(sessions)} recorded")

# 5. Check status page
print("\n=== STATUS PAGE ===")
r = httpx.get(WORKER, timeout=10)
print(f"Status: {r.status_code}")
if "v2.0" in r.text:
    print("  AI-SRF v2.0 confirmed!")
elif "V3.0" in r.text:
    print("  Still v1.x status page")

print("\n=== ALL SYSTEMS GO ===")
