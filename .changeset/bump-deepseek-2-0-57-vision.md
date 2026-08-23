---
'@cherrystudio/ai-core': patch
---

Bump `@ai-sdk/deepseek` from 2.0.30 to 2.0.57 to pick up upstream support for DeepSeek's vision models (`image_url` / base64 / file content parts in `convertToDeepSeekChatMessages`), fixing image attachments being silently dropped when sent to `deepseek-v4-flash-vision-exp`. Drop the local patch adding `reasoning_effort`: 2.0.57 ships the equivalent `reasoningEffort` option natively.
