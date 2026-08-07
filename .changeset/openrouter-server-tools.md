---
'@cherrystudio/ai-core': patch
---

Migrate OpenRouter's built-in web search and web fetch to OpenRouter's native server tools (`openrouter:web_search` / `openrouter:web_fetch`), replacing the deprecated `plugins: [{ id: 'web' }]` route so they ride the standard `tools` array as provider-defined tools alongside function tools. Extends the local `@openrouter/ai-sdk-provider` patch to complete `WebSearchToolArgs` with domain filtering (`allowedDomains` / `excludedDomains`) and to expose a `webFetch` provider tool.
