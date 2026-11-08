---
'@cherrystudio/ai-core': patch
---

Assign the resolved model to `context.model` in the non-streaming text and image paths, so plugins observe the same resolved model there as they do in the streaming path.
