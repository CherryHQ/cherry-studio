---
'@cherrystudio/provider-registry': patch
---

Add AI Stupid Level as a provider: an OpenAI-compatible Smart Router whose routing modes (`auto-coding`, `auto-reasoning`, `auto-tooling`, `auto-cheapest`, `auto-split`, ...) choose the model for each request by the strategy they name (benchmark scores, value, speed, price or the account's own traffic split), using the user's own provider keys. Routing modes are provider-owned with function calling and structured output, the adapter forwards `response_format.json_schema` to the router, and every model on this text-only router has its image, audio, video and file input removed.
