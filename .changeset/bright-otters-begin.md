---
'@cherrystudio/ai-core': patch
---

Fix stalled MCP recursive streams by moving the timeout to the actual stream read path and by failing loudly when recursive results do not include a readable fullStream.