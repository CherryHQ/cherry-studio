---
'@cherrystudio/ai-core': patch
---

Rewrite legacy `max_tokens` to `max_completion_tokens` for GPT-5.x/o-series models on openai-compatible providers. The AI SDK's openai-compatible layer always emits `max_tokens` on the wire, which those model families reject outright (`400 Unsupported parameter`). A thin fetch wrapper at the provider construction boundary renames the parameter on matching request bodies while forwarding everything else untouched.
