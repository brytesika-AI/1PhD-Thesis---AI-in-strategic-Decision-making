"""Comprehensive AI-SRF v2.0 System Verification."""
import httpx
import json
import time

WORKER = "https://ai-srf-worker.bryte-sika.workers.dev"
DASHBOARD = "https://ai-srf-dashboard.pages.dev"

def test(name, passed, detail=""):
    status = "PASS" if passed else "FAIL"
    print(f"  [{status}] {name}" + (f" — {detail}" if detail else ""))
    return passed

results = []

# ━━━ 1. Worker Health ━━━
print("\n=== 1. WORKER HEALTH ===")
try:
    r = httpx.get(WORKER, timeout=15)
    results.append(test("Worker status page", r.status_code == 200, f"HTTP {r.status_code}"))
    results.append(test("v2.0 confirmed", "v2.0" in r.text or "V2.0" in r.text or "v2" in r.text.lower()))
except Exception as e:
    results.append(test("Worker reachable", False, str(e)))

# ━━━ 2. Risk Intelligence Feed ━━━
print("\n=== 2. RISK INTELLIGENCE (Sensing Layer) ===")
try:
    r = httpx.get(f"{WORKER}/api/sensing/risks", timeout=15)
    data = r.json()
    results.append(test("Risk feed endpoint", r.status_code == 200))
    results.append(test("Signals present", len(data) > 0, f"{len(data)} signals"))
    
    # Check for live news (non-seeded)
    live = [s for s in data if s.get("source") not in ["AI-SRF Seed", "Seed"]]
    results.append(test("Live news ingested", len(live) > 0, f"{len(live)} live articles"))
    
    # Print top 5
    for s in data[:5]:
        cat = s.get("risk_category", "?")
        score = s.get("risk_score", "?")
        title = s.get("title", "?")[:70]
        src = s.get("source", "?")
        print(f"    [{cat}] Score {score}: {title} ({src})")
except Exception as e:
    results.append(test("Risk feed", False, str(e)))

# ━━━ 3. Institutional Memory ━━━
print("\n=== 3. INSTITUTIONAL MEMORY ===")
try:
    r = httpx.get(f"{WORKER}/api/memory?org=default", timeout=15)
    data = r.json()
    results.append(test("Memory endpoint", r.status_code == 200))
    mem = data.get("memory", "")
    prof = data.get("profile", "")
    results.append(test("Memory populated", len(mem) > 20, f"{len(mem)} chars"))
    results.append(test("Profile populated", len(prof) > 20, f"{len(prof)} chars"))
    print(f"    Memory preview: {mem[:120]}...")
    print(f"    Profile preview: {prof[:120]}...")
except Exception as e:
    results.append(test("Memory", False, str(e)))

# ━━━ 4. Skill Store ━━━
print("\n=== 4. SKILL STORE ===")
try:
    r = httpx.get(f"{WORKER}/api/skills?org=default", timeout=15)
    data = r.json()
    results.append(test("Skills endpoint", r.status_code == 200))
    count = data.get("count", 0)
    print(f"    Accumulated skills: {count}")
except Exception as e:
    results.append(test("Skills", False, str(e)))

# ━━━ 5. Decision Sessions ━━━
print("\n=== 5. DECISION SESSIONS ===")
try:
    r = httpx.get(f"{WORKER}/api/sessions?org=default", timeout=15)
    data = r.json()
    results.append(test("Sessions endpoint", r.status_code == 200))
    print(f"    Recorded sessions: {len(data)}")
except Exception as e:
    results.append(test("Sessions", False, str(e)))

# ━━━ 6. ROR Metrics ━━━
print("\n=== 6. ROR METRICS ===")
try:
    r = httpx.get(f"{WORKER}/api/ror?org=default", timeout=15)
    data = r.json()
    results.append(test("ROR endpoint", r.status_code == 200))
    print(f"    Metrics recorded: {len(data)}")
except Exception as e:
    results.append(test("ROR", False, str(e)))

# ━━━ 7. Inference Proxy (Core Agent Pipeline) ━━━
print("\n=== 7. INFERENCE PROXY (Agent Pipeline) ===")
try:
    payload = {
        "system": "You are The Induna — Socratic Partner of the AI-SRF. Respond briefly with 2 diagnostic questions.",
        "messages": [{"role": "user", "content": "We are evaluating a cloud migration under POPIA constraints."}],
        "stream": False,
        "orgId": "test-verify",
        "sessionId": "verify-001",
        "stage": 1
    }
    r = httpx.post(WORKER, json=payload, timeout=60)
    results.append(test("Inference responds", r.status_code == 200, f"HTTP {r.status_code}"))
    
    data = r.json()
    response_text = data.get("response", "")
    results.append(test("Response has content", len(response_text) > 50, f"{len(response_text)} chars"))
    
    # Check governance tone (should NOT contain chatbot phrases)
    chatbot_phrases = ["Great question", "I'd be happy to", "you might want to consider", "As an AI"]
    has_chatbot = any(p.lower() in response_text.lower() for p in chatbot_phrases)
    results.append(test("Governance tone (no chatbot phrases)", not has_chatbot))
    
    # Check for regulatory grounding
    regulatory_refs = ["POPIA", "King IV", "data residency", "Act 4"]
    has_regulatory = any(r.lower() in response_text.lower() for r in regulatory_refs)
    results.append(test("Regulatory grounding present", has_regulatory))
    
    print(f"    Response preview: {response_text[:200]}...")
except Exception as e:
    results.append(test("Inference", False, str(e)))

# ━━━ 8. News Ingestion Trigger ━━━
print("\n=== 8. NEWS INGESTION TRIGGER ===")
try:
    r = httpx.post(f"{WORKER}/api/sensing/trigger", timeout=15)
    data = r.json()
    results.append(test("Trigger endpoint", r.status_code == 200 and data.get("ok")))
except Exception as e:
    results.append(test("Trigger", False, str(e)))

# ━━━ 9. Learning Endpoint ━━━
print("\n=== 9. LEARNING / COMPLETE-CYCLE ===")
try:
    payload = {
        "sessionId": "verify-001",
        "orgId": "test-verify",
        "query": "Cloud migration under POPIA",
        "riskState": "ELEVATED",
        "sector": "financial_services",
        "stageCount": 6,
        "themes": "POPIA data residency, King IV oversight"
    }
    r = httpx.post(f"{WORKER}/api/learning/complete-cycle", json=payload, timeout=15)
    data = r.json()
    results.append(test("Learning endpoint", r.status_code == 200 and data.get("ok")))
except Exception as e:
    results.append(test("Learning", False, str(e)))

# ━━━ 10. Dashboard ━━━
print("\n=== 10. DASHBOARD (Frontend) ===")
try:
    r = httpx.get(DASHBOARD, timeout=15)
    results.append(test("Dashboard loads", r.status_code == 200))
    results.append(test("Has onboarding form", "execName" in r.text))
    results.append(test("Has agent prompts", "Socratic Partner" in r.text or "The Induna" in r.text))
    results.append(test("Has self-learning wiring", "sessionId" in r.text and "orgId" in r.text))
    results.append(test("Has 3 mandatory lenses", "LENS A" in r.text and "LENS B" in r.text and "LENS C" in r.text))
    results.append(test("Has 3 option archetypes", "THE HEDGE" in r.text and "THE EXPLOIT" in r.text and "THE DEFER" in r.text))
    results.append(test("Has 5 stress-tests", "FAILURE MODE" in r.text and "ASSUMPTION AUDIT" in r.text and "HALLUCINATION" in r.text))
    results.append(test("Has capability tiers", "TIER 1" in r.text and "TIER 2" in r.text and "TIER 3" in r.text))
    results.append(test("Has identity contract ref", "complete-cycle" in r.text))
    results.append(test("Has ROR indicators", "Decision Alpha" in r.text or "DLR" in r.text))
except Exception as e:
    results.append(test("Dashboard", False, str(e)))

# ━━━ 11. Learning Override (Improvement Rules) ━━━
print("\n=== 11. LEARNING OVERRIDE ===")
try:
    payload = {"agent": "The Induna", "rule": "Always cite SARB exchange rate data when currency signals are present.", "source": "verification"}
    r = httpx.post(f"{WORKER}/api/learning/override", json=payload, timeout=15)
    results.append(test("Override endpoint", r.status_code == 200))
except Exception as e:
    results.append(test("Override", False, str(e)))

# ━━━ FINAL REPORT ━━━
passed = sum(results)
total = len(results)
print(f"\n{'='*60}")
print(f"  AI-SRF v2.0 VERIFICATION: {passed}/{total} tests passed")
print(f"{'='*60}")
if passed == total:
    print("  ALL SYSTEMS OPERATIONAL")
else:
    failed = [i for i, r in enumerate(results) if not r]
    print(f"  {total - passed} test(s) failed")
