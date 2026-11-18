---
'@cherrystudio/ai-core': major
---

Require EntityToolOutputCodec skeletons and assembled outputs to satisfy the AI SDK JSONValue contract. Custom codecs must return JSON-compatible values and pass their own deflated skeletons back to assemble; non-matching inputs can still be declined by returning null from deflate.
