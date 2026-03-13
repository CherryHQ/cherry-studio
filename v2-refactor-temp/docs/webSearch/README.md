# Web Search Pending Notes

## Zhipu provider sync

- Current state:
  The runtime web search provider configuration has started moving to `chat.web_search.provider_overrides`, but the existing Zhipu linkage in `src/renderer/src/pages/settings/ProviderSettings/ProviderSetting.tsx` still mirrors the key through `state.websearch.providers`.
- Temporary decision:
  Do not add a stopgap fix here for now. Keep the current behavior unchanged until the provider sync strategy is clarified.
- Reason:
  This is not just a single field write anymore. The correct fix should define how the LLM `zhipu` provider and the Web Search `zhipu` provider stay synchronized under the v2 preference-backed model, instead of continuing to patch the legacy Redux path.

## Preserve unresolved RAG model ids

- Current state:
  Compression settings are rebuilt from resolved runtime `Model` objects.
- Problem:
  If a saved embedding or rerank model id no longer resolves to a live provider/model, the resolved runtime object becomes `undefined`. Later updates to unrelated compression settings can serialize those unresolved ids back to `null`, silently deleting the saved selection.
- Temporary decision:
  Do not change behavior yet. Record this as a follow-up item and handle it together with the next compression settings pass.
- Recommended fix direction:
  Preserve the raw stored ids alongside resolved runtime models, and when updating unrelated compression fields, reuse the existing raw ids unless the user explicitly changes or clears the model selection.

## Follow-up requirements

- Define the source of truth for shared Zhipu credentials between LLM provider settings and Web Search provider settings.
- Update both UI write paths and runtime read paths to use the same backend.
- Avoid adding more temporary Redux-only sync logic.
- Add follow-up support for managing multiple API keys in Web Search settings.
- Preserve unresolved compression model ids when editing unrelated settings.
- Add regression coverage for:
  changing Zhipu API key from general Provider Settings,
  opening Web Search Settings afterward,
  using Zhipu web search at runtime,
  editing compression settings while stored model ids are unresolved.

## Affected area

- `src/renderer/src/pages/settings/ProviderSettings/ProviderSetting.tsx`
- `src/renderer/src/hooks/useWebSearchProviders.ts`
- `src/renderer/src/services/WebSearchService.ts`
- `src/renderer/src/config/webSearch/provider.ts`
- `src/renderer/src/config/webSearch/setting.ts`
