---
'@cherrystudio/ai-sdk-provider': patch
---

Omit the unsupported `strict` tool field on CherryIN's Anthropic endpoint, whose Bedrock-backed upstream rejects it as an extra input.
