---
'@cherrystudio/ai-sdk-provider': patch
---

Always route DeepSeek models through the chat-completions path in CherryIN so the reasoning_content patch (#18121) applies regardless of configured endpoint type. Also emit empty reasoning_content in OpenAI-compatible SSE streams for DeepSeek models on turns with no reasoning so the streamed assistant message always carries the key. Fixes #18150.
