"""Test Google News RSS directly and trigger fresh ingestion."""
import httpx
import re

WORKER = "https://ai-srf-worker.bryte-sika.workers.dev"

# 1. Test Google News RSS directly
print("=== GOOGLE NEWS RSS (Direct Test) ===")
topics = [
    "South Africa load shedding Eskom energy",
    "South Africa POPIA data protection corporate governance",
    "South Africa rand ZAR exchange rate SARB",
]

total_articles = 0
for topic in topics:
    url = f"https://news.google.com/rss/search?q={topic.replace(' ', '+')}&hl=en-ZA&gl=ZA&ceid=ZA:en"
    try:
        r = httpx.get(url, timeout=15, follow_redirects=True)
        items = re.findall(r'<item>([\s\S]*?)</item>', r.text)
        print(f"\n  Topic: '{topic[:50]}...' => {len(items)} articles")
        for item in items[:3]:
            title_match = re.search(r'<title>(.*?)</title>', item)
            source_match = re.search(r'<source[^>]*>(.*?)</source>', item)
            pub_match = re.search(r'<pubDate>(.*?)</pubDate>', item)
            if title_match:
                title = title_match.group(1).replace('<![CDATA[', '').replace(']]>', '').strip()
                source = source_match.group(1) if source_match else "?"
                pub = pub_match.group(1)[:25] if pub_match else "?"
                print(f"    [{source}] {title[:80]}")
                print(f"      Published: {pub}")
                total_articles += 1
    except Exception as e:
        print(f"  ERROR: {e}")

print(f"\n  Total live articles found: {total_articles}")

# 2. Check current DB signals
print("\n=== CURRENT DB SIGNALS ===")
r = httpx.get(f"{WORKER}/api/sensing/risks", timeout=15)
data = r.json()
print(f"  Total in DB: {len(data)}")
for s in data[:5]:
    print(f"    [{s.get('risk_category','?')}] Score {s.get('risk_score','?')}: {s.get('title','?')[:70]} ({s.get('source','?')})")

# 3. Trigger fresh ingestion
print("\n=== TRIGGERING FRESH INGESTION ===")
r = httpx.post(f"{WORKER}/api/sensing/trigger", timeout=15)
print(f"  Trigger: {r.json()}")
print("  Waiting 45s for async ingestion + AI scoring...")

import time
time.sleep(45)

# 4. Check results
print("\n=== POST-INGESTION SIGNALS ===")
r = httpx.get(f"{WORKER}/api/sensing/risks", timeout=15)
data = r.json()
print(f"  Total in DB: {len(data)}")
for s in data[:10]:
    cat = s.get('risk_category', '?')
    score = s.get('risk_score', '?')
    title = s.get('title', '?')[:70]
    source = s.get('source', '?')
    ts = s.get('timestamp', '?')[:19]
    print(f"    [{cat}] Score {score}: {title}")
    print(f"      Source: {source} | Ingested: {ts}")
