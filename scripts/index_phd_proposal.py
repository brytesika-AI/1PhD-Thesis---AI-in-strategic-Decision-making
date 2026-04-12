import os
import json
import httpx
from docx import Document

# ── Config ───────────────────────────────────────────────────
# Use account details found during research
CF_ACCOUNT_ID = "244693f2079c982e757ff6ec7dbd8f96"
CF_API_TOKEN  = os.environ.get("CF_API_TOKEN") # Will be passed via terminal
VECTORIZE_INDEX = "aisrf-phd-index"
KV_NAMESPACE_ID = "5aa1df4235b64bc2b0fabb9c512ad05d"
PHD_DOC_PATH = r"C:\Users\bright.sikazwe\Downloads\1PhD Thesis - AI in strategic Decision making\PhD_Proposal_FINAL_SUBMISSION_Apr2026_.docx"
CHUNK_SIZE = 400
CHUNK_OVERLAP = 50
BATCH_SIZE = 100 

BASE_URL = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}"
HEADERS  = {
    "Authorization": f"Bearer {CF_API_TOKEN}",
    "Content-Type": "application/json"
}

# ── Extract text from .docx ──────────────────────────────────
def extract_docx_text(path: str) -> str:
    doc = Document(path)
    return "\n".join(
        p.text.strip() for p in doc.paragraphs if p.text.strip()
    )

# ── Chunk text ───────────────────────────────────────────────
def chunk_text(text: str) -> list[dict]:
    words = text.split()
    chunks = []
    i = 0
    chunk_id = 0
    while i < len(words):
        chunk_words = words[i:i + CHUNK_SIZE]
        chunk_text = " ".join(chunk_words)
        chunks.append({
            "id": f"phd_chunk_{chunk_id}",
            "text": chunk_text
        })
        chunk_id += 1
        i += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks

# ── Generate embeddings via Workers AI REST API ──────────────
def embed_texts(texts: list[str]) -> list[list[float]]:
    url = f"{BASE_URL}/ai/run/@cf/baai/bge-small-en-v1.5"
    response = httpx.post(
        url,
        headers=HEADERS,
        json={"text": texts},
        timeout=120
    )
    response.raise_for_status()
    result = response.json()
    return result["result"]["data"]

# ── Upload vectors to Vectorize ──────────────────────────────
def upsert_vectors(vectors: list[dict]):
    url = f"{BASE_URL}/vectorize/v2/indexes/{VECTORIZE_INDEX}/upsert"
    for i in range(0, len(vectors), BATCH_SIZE):
        batch = vectors[i:i + BATCH_SIZE]
        response = httpx.post(
            url,
            headers=HEADERS,
            json={"vectors": batch},
            timeout=120
        )
        response.raise_for_status()
        print(f"Upserted batch {i // BATCH_SIZE + 1}: {len(batch)} vectors")

# ── Store raw chunks in KV ───────────────────────────────────
def store_chunks_in_kv(chunks: list[dict]):
    url = f"{BASE_URL}/storage/kv/namespaces/{KV_NAMESPACE_ID}/bulk"
    kv_pairs = [
        {"key": chunk["id"], "value": chunk["text"]}
        for chunk in chunks
    ]
    for i in range(0, len(kv_pairs), 100):
        batch = kv_pairs[i:i + 100]
        response = httpx.put(
            url,
            headers=HEADERS,
            json=batch,
            timeout=120
        )
        response.raise_for_status()
        print(f"KV stored batch {i // 100 + 1}: {len(batch)} chunks")

# ── Main indexing pipeline ───────────────────────────────────
def main():
    if not CF_API_TOKEN:
        print("ERROR: CF_API_TOKEN environment variable not set.")
        return

    print("Extracting PhD proposal text...")
    text = extract_docx_text(PHD_DOC_PATH)
    print(f"Extracted {len(text.split())} words.")

    print("Chunking text...")
    chunks = chunk_text(text)
    print(f"Created {len(chunks)} chunks.")

    print("Generating embeddings via Workers AI...")
    all_texts = [c["text"] for c in chunks]
    
    all_embeddings = []
    # Smaller batches to avoid 504 timeouts on Workers AI
    for i in range(0, len(all_texts), 25):
        batch = all_texts[i:i + 25]
        embeddings = embed_texts(batch)
        all_embeddings.extend(embeddings)
        print(f"Embedded {min(i + 25, len(all_texts))} / {len(all_texts)} chunks")

    print("Uploading vectors to Cloudflare Vectorize...")
    vectors = [
        {
            "id": chunks[i]["id"],
            "values": all_embeddings[i],
            "metadata": {
                "source": "PhD_Proposal_Sikazwe_2026"
            }
        }
        for i in range(len(chunks))
    ]
    upsert_vectors(vectors)

    print("Storing raw chunks in Cloudflare KV...")
    store_chunks_in_kv(chunks)

    print("DONE. PhD proposal indexed successfully.")

if __name__ == "__main__":
    main()
