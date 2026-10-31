---
'@cherrystudio/provider-registry': patch
---

Add AI Stupid Level as a provider: an OpenAI-compatible Smart Router whose routing modes (`auto-coding`, `auto-reasoning`, `auto-tooling`, ...) send each request to the model that currently scores best on its benchmarks, using the user's own provider keys. Routing modes are provider-owned with function calling and structured output, and every model on this text-only router has its image, audio, video and file input removed.
