---
'@cherrystudio/ai-core': major
---

Migrate to AI SDK v6 - complete rewrite of provider and middleware architecture

- **BREAKING**: Remove all legacy API clients, middleware pipeline, and barrel `index.ts`
- **Image generation**: Migrate to native AI SDK `generateImage`/`editImage`, remove legacy image middleware
- **Embedding**: Migrate to AI SDK `embedMany`, remove legacy embedding clients
- **Model listing**: Refactor `ModelListService` to Strategy Registry pattern, consolidate schema files
- **OpenRouter image**: Native image endpoint support via `@openrouter/ai-sdk-provider` 2.3.3
- **GitHub Copilot**: Simplify extension by removing `ProviderV2` cast and `wrapProvider`
- **Rename**: `index_new.ts` → `AiProvider.ts`, `ModelListService.ts` → `listModels.ts`
