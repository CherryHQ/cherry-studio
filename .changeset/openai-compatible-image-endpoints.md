---
'@cherrystudio/ai-core': patch
---

Fix OpenAI-compatible image generation when providers use explicit image endpoints or versioned API hosts.

- Honor explicit `images/generations` and `images/edits` endpoints for image models without rerouting chat traffic.
- Validate dedicated image-generation models through `generateImage()` so broken image-only configs fail the API check correctly.
- Retry OpenAI-compatible image requests once against a de-versioned base URL after a 404 from a versioned host.