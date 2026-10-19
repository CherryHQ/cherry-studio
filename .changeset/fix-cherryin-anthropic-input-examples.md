---
'@cherrystudio/ai-sdk-provider': patch
---

Fix CherryIN Anthropic requests by omitting unsupported tool input examples in both generation and streaming calls while preserving the caller's tools and other endpoints.
