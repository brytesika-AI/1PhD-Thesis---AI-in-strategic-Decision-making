"""
AI-SRF Regulatory Document Indexer — Worker Proxy Architecture
Source: AI-SRF Proposal, Sikazwe (2026)

Pushes document chunks to the Cloudflare Worker, which performs:
  1. Embedding via Workers AI (@cf/baai/bge-small-en-v1.5)
  2. Vectorize upsert via binding
  3. KV storage via binding

This eliminates the need for Vectorize API tokens.
"""
import os
import httpx
from pypdf import PdfReader

# ── Config ───────────────────────────────────────────────────
WORKER_URL = os.environ.get("WORKER_URL", "https://ai-srf-worker.bryte-sika.workers.dev")

REG_DOCS = [
    r"c:\Users\bright.sikazwe\Downloads\1PhD Thesis - AI in strategic Decision making\docs\regulations\king_iv.md",
    r"c:\Users\bright.sikazwe\Downloads\1PhD Thesis - AI in strategic Decision making\3706726-11act4of2013protectionofpersonalinforcorrect.pdf",
    r"c:\Users\bright.sikazwe\Downloads\1PhD Thesis - AI in strategic Decision making\king-iv-comparison.pdf",
    r"c:\Users\bright.sikazwe\Downloads\1PhD Thesis - AI in strategic Decision making\King_V_Code.pdf"
]

CHUNK_SIZE = 400
CHUNK_OVERLAP = 50
BATCH_SIZE = 10  # Smaller batches for Worker proxy (avoids timeout)

# ── Extraction ───────────────────────────────────────────────
def get_content(path: str) -> str:
    if path.endswith('.md'):
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    elif path.endswith('.pdf'):
        reader = PdfReader(path)
        text = ""
        for page in reader.pages:
            text += page.extract_text() + "\n"
        return text
    return ""

# ── Chunking ───────────────────────────────────────────────
def chunk_text(text: str, source_name: str) -> list[dict]:
    words = text.split()
    chunks = []
    i = 0
    chunk_id_base = source_name.replace(" ", "_").lower()
    c_num = 0
    while i < len(words):
        chunk_words = words[i:i + CHUNK_SIZE]
        chunk_text = " ".join(chunk_words)
        chunks.append({
            "id": f"reg_{chunk_id_base}_{c_num}",
            "text": f"[Source: {source_name}] {chunk_text}",
            "source": source_name
        })
        c_num += 1
        i += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks

# ── Worker Proxy Ingestion ────────────────────────────────────
def ingest_via_worker(chunks: list[dict]):
    """Push chunks to the Worker's /api/ingest/chunks endpoint."""
    url = f"{WORKER_URL}/api/ingest/chunks"
    for i in range(0, len(chunks), BATCH_SIZE):
        batch = chunks[i:i + BATCH_SIZE]
        response = httpx.post(
            url,
            json={"chunks": batch},
            timeout=120
        )
        response.raise_for_status()
        result = response.json()
        print(f"  Batch {i//BATCH_SIZE + 1}: Indexed {result.get('indexed', 0)} chunks, {result.get('vectors', 0)} vectors")

# ── Main ────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("AI-SRF Regulatory Document Indexer (Worker Proxy)")
    print("=" * 60)
    
    for doc_path in REG_DOCS:
        if not os.path.exists(doc_path):
            print(f"[SKIP] Skipping missing file: {doc_path}")
            continue
            
        source_name = os.path.basename(doc_path)
        print(f"\n[DOC] Processing {source_name}...")
        text = get_content(doc_path)
        if not text:
            print(f"  [WARN] Empty content, skipping.")
            continue
        
        chunks = chunk_text(text, source_name)
        print(f"  [CHUNK] Created {len(chunks)} chunks.")
        
        try:
            ingest_via_worker(chunks)
            print(f"  [OK] Successfully indexed {source_name}")
        except Exception as e:
            print(f"  [FAIL] Indexing failed for {source_name}: {e}")

    print("\n" + "=" * 60)
    print("Indexing complete.")
    print("=" * 60)

if __name__ == "__main__":
    main()
