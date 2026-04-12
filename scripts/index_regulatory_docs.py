import os
import httpx
from pypdf import PdfReader

# ── Config ───────────────────────────────────────────────────
CF_ACCOUNT_ID = "244693f2079c982e757ff6ec7dbd8f96"
CF_API_TOKEN  = os.environ.get("CF_API_TOKEN", "cfut_ePJUS64PcjuceBWPx6M5jTzhLWcjkbn1jp7R2wev72c6f0fb")
VECTORIZE_INDEX = "aisrf-phd-index"
KV_NAMESPACE_ID = "5aa1df4235b64bc2b0fabb9c512ad05d"

REG_DOCS = [
    r"c:\Users\bright.sikazwe\Downloads\1PhD Thesis - AI in strategic Decision making\docs\regulations\king_iv.md",
    r"c:\Users\bright.sikazwe\Downloads\1PhD Thesis - AI in strategic Decision making\3706726-11act4of2013protectionofpersonalinforcorrect.pdf",
    r"c:\Users\bright.sikazwe\Downloads\1PhD Thesis - AI in strategic Decision making\king-iv-comparison.pdf",
    r"c:\Users\bright.sikazwe\Downloads\1PhD Thesis - AI in strategic Decision making\King_V_Code.pdf"
]

CHUNK_SIZE = 400
CHUNK_OVERLAP = 50
BATCH_SIZE = 100 

BASE_URL = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}"
HEADERS  = {
    "Authorization": f"Bearer {CF_API_TOKEN}",
    "Content-Type": "application/json"
}

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
            "text": f"[Source: {source_name}] {chunk_text}"
        })
        c_num += 1
        i += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks

# ── Cloudflare APIs ──────────────────────────────────────────
def embed_texts(texts: list[str]) -> list[list[float]]:
    url = f"{BASE_URL}/ai/run/@cf/baai/bge-small-en-v1.5"
    response = httpx.post(url, headers=HEADERS, json={"text": texts}, timeout=120)
    response.raise_for_status()
    return response.json()["result"]["data"]

def upsert_vectors(vectors: list[dict]):
    url = f"{BASE_URL}/vectorize/v2/indexes/{VECTORIZE_INDEX}/upsert"
    for i in range(0, len(vectors), BATCH_SIZE):
        batch = vectors[i:i + BATCH_SIZE]
        response = httpx.post(url, headers=HEADERS, json={"vectors": batch}, timeout=120)
        response.raise_for_status()
        print(f"Upserted {len(batch)} vectors")

def store_kv(chunks: list[dict]):
    url = f"{BASE_URL}/storage/kv/namespaces/{KV_NAMESPACE_ID}/bulk"
    kv_pairs = [{"key": c["id"], "value": c["text"]} for c in chunks]
    for i in range(0, len(kv_pairs), 100):
        batch = kv_pairs[i:i + 100]
        httpx.put(url, headers=HEADERS, json=batch, timeout=120).raise_for_status()
        print(f"Stored {len(batch)} items in KV")

# ── Main ────────────────────────────────────────────────────
def main():
    for doc_path in REG_DOCS:
        if not os.path.exists(doc_path):
            print(f"Skipping missing file: {doc_path}")
            continue
            
        source_name = os.path.basename(doc_path)
        print(f"Processing {source_name}...")
        text = get_content(doc_path)
        if not text: continue
        
        chunks = chunk_text(text, source_name)
        print(f"Created {len(chunks)} chunks.")
        
        all_texts = [c["text"] for c in chunks]
        all_embeddings = []
        for i in range(0, len(all_texts), 25):
            batch = all_texts[i:i + 25]
            all_embeddings.extend(embed_texts(batch))
            print(f"Progress: {min(i + 25, len(all_texts))} / {len(all_texts)}")
        
        vectors = [
            {"id": chunks[j]["id"], "values": all_embeddings[j], "metadata": {"source": source_name}}
            for j in range(len(chunks))
        ]
        upsert_vectors(vectors)
        store_kv(chunks)
        print(f"Successfully indexed {source_name}")

if __name__ == "__main__":
    main()
