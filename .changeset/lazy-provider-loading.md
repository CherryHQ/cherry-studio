---
'@cherrystudio/ai-core': patch
---

Load provider SDK implementations when their provider is created, and defer OpenAI-compatible reranking setup until the first rerank request.
