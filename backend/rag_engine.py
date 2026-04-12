import chromadb
from pathlib import Path
from typing import List, Dict, Any
import os

class RAGEngine:
    """Regulation-grounded RAG engine using ChromaDB."""

    def __init__(self):
        self.db_path = str(Path(__file__).parent.parent / "chroma_db")
        self.client = chromadb.PersistentClient(path=self.db_path)
        self.collection = self.client.get_or_create_collection(
            name="regulations",
            metadata={"hnsw:space": "cosine"}
        )
        self._initial_load()

    def _initial_load(self):
        docs_path = Path(__file__).parent.parent / "docs" / "regulations"
        if not docs_path.exists():
            return

        for doc_file in docs_path.glob("*.md"):
            with open(doc_file, "r", encoding="utf-8") as f:
                content = f.read()
                # Simple chunking by header or paragraph
                chunks = content.split("\n## ")
                for i, chunk in enumerate(chunks):
                    chunk_id = f"{doc_file.stem}_{i}"
                    # Check if already exists to avoid duplicates
                    if not self.collection.get(ids=[chunk_id])["ids"]:
                        self.collection.add(
                            documents=[chunk],
                            ids=[chunk_id],
                            metadatas=[{"source": doc_file.name}]
                        )

    def retrieve(self, query: str, k: int = 3) -> List[Dict[str, Any]]:
        results = self.collection.query(
            query_texts=[query],
            n_results=k
        )
        
        output = []
        if results["documents"]:
            for i in range(len(results["documents"][0])):
                output.append({
                    "text": results["documents"][0][i],
                    "source": results["metadatas"][0][i]["source"],
                    "score": results["distances"][0][i] if "distances" in results else 0.0
                })
        return output
