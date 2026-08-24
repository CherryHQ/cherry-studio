---
'@cherrystudio/ai-core': patch
---

Add rerank runtime support. Exposes a `rerank` runtime helper (plus `RerankParams` / `RerankResult` types and `RuntimeExecutor.rerank`) and an `OpenAICompatibleRerankingModel` provider model (with `createOpenAICompatibleRerankingModel` and its config/settings types) so OpenAI-compatible providers can serve reranking through the standard runtime.
