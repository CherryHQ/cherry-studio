---
'@cherrystudio/ai-core': patch
---

Fix the Azure OpenAI chat-mode extension crashing on native web search: the `customProvider` wrapper returned by `AzureExtension.create` now carries the SDK provider's `tools`, so `toolFactories.webSearch` no longer dereferences `provider.tools.webSearchPreview` on `undefined`.
