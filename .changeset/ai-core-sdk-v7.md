---
'@cherrystudio/ai-core': major
'@cherrystudio/ai-sdk-provider': minor
---

Upgrade to AI SDK 7 with V4 model and middleware contracts, scoped tool context, and native tool execution callbacks. Upgrade bundled official providers and CherryIN to native V4, including image generation/editing, embeddings, reranking, speech, and transcription. Third-party V3 language providers remain accepted through the SDK compatibility adapter. Provider tool capabilities are marked as server executed.

Requires Node.js 22 or later and `ai@^7.0.127`. The package now publishes ESM only; migrate CommonJS consumers to `import` or dynamic `import()`. Custom middleware must use the V4 contract, and agent settings follow the AI SDK 7 API.
