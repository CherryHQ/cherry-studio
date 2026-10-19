---
'@cherrystudio/provider-registry': patch
---

Add AI Stupid Level as a provider: an OpenAI-compatible Smart Router whose routing modes (`auto-coding`, `auto-reasoning`, `auto-tooling`, ...) send each request to the model that currently scores best on its benchmarks, using the user's own provider keys. The model list comes from `/v1/models` at runtime.
