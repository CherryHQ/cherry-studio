---
'@cherrystudio/ai-sdk-provider': patch
---

Always route DeepSeek models through the chat-completions path in CherryIN so the #18121 reasoning_content patch applies. An explicit openai-responses endpoint can no longer bypass the routing. Fixes #18150.
