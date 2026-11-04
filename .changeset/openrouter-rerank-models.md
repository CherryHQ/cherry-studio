---
'@cherrystudio/ai-core': patch
'@cherrystudio/provider-registry': patch
---

Discover OpenRouter reranking models and rerank through the OpenRouter provider: the model list now reads the rerank catalog (`?output_modalities=rerank`) and marks those models as rerank-capable, and the OpenRouter extension now provides a reranking model so the connection check reaches `POST /api/v1/rerank` instead of failing with `No such rerankingModel`.
