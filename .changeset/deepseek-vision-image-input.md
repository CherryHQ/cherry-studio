---
'@cherrystudio/ai-core': patch
---

Upgrade @ai-sdk/deepseek to 2.0.57 so DeepSeek vision models receive image input. The previous version flattened user messages into a plain string and dropped every non-text part, and it is no longer patched locally.
