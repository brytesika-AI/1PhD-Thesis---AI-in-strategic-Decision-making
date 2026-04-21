"""Index just the King V Code PDF which requires the cryptography package."""
import httpx
from pypdf import PdfReader

WORKER = "https://ai-srf-worker.bryte-sika.workers.dev"
path = r"c:\Users\bright.sikazwe\Downloads\1PhD Thesis - AI in strategic Decision making\King_V_Code.pdf"

print("Reading King V Code PDF...")
try:
    reader = PdfReader(path)
    text = ""
    for page in reader.pages:
        t = page.extract_text()
        if t:
            text += t + "\n"
    print(f"Pages: {len(reader.pages)}, Words: {len(text.split())}")
except Exception as e:
    print(f"Failed to read PDF: {e}")
    exit(1)

words = text.split()
chunks = []
CHUNK_SIZE = 400
OVERLAP = 50
i = 0
c = 0
while i < len(words):
    chunk_words = words[i:i + CHUNK_SIZE]
    chunk_text = " ".join(chunk_words)
    chunks.append({
        "id": f"reg_king_v_code.pdf_{c}",
        "text": f"[Source: King_V_Code.pdf] {chunk_text}",
        "source": "King_V_Code.pdf"
    })
    c += 1
    i += CHUNK_SIZE - OVERLAP

print(f"Created {len(chunks)} chunks.")

BATCH = 10
for k in range(0, len(chunks), BATCH):
    batch = chunks[k:k + BATCH]
    r = httpx.post(f"{WORKER}/api/ingest/chunks", json={"chunks": batch}, timeout=120)
    r.raise_for_status()
    result = r.json()
    print(f"  Batch {k // BATCH + 1}: Indexed {result.get('indexed', 0)} chunks")

print("King V indexing complete.")
