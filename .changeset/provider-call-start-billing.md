---
'@cherrystudio/ai-core': minor
---

Add an optional `onProviderCallStart` callback to capture request-specific context before each image, embedding, or reranking provider invocation, including SDK retries and batches. Preserve unobserved reranking models and isolate observation failures from successful AI results.
