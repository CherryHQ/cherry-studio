---
'@cherrystudio/ai-core': minor
---

Remove unused exports, dead types, and over-engineered abstractions from aiCore

- Remove unused public exports: `createOpenAICompatibleExecutor`, `create*Options`, `mergeProviderOptions`, `PluginManager`, `createContext`, `AI_CORE_VERSION`, `AI_CORE_NAME`, `BUILT_IN_PLUGIN_PREFIX`, `registeredProviderIds`, `ProviderInitializationError`, `ProviderExtensionBuilder`, `createProviderExtension`
- Delete dead type definitions: `HookResult`, `PluginManagerConfig`, `AiRequestMetadata`, `ExtractProviderOptions`, `ProviderOptions`, `CoreProviderSettingsMap` (re-added as internal), `ExtractExtensionIds`, `ExtractExtensionSettings`
- Remove over-engineered `ExtensionStorage` system: delete `ExtensionStorage`, `StorageAccessor`, `ExtensionContext`, `ExtensionHook`, `LifecycleHooks` types; remove `TStorage` generic parameter from `ProviderExtension` (4 → 3 type params); remove `_storage`, `storage` getter, `createContext`, `executeHook`, `initialStorage`, `hooks` from class and config
- Delete `create*Options` convenience functions and inline `createOpenRouterOptions` at its only call site
- Delete `DEFAULT_WEB_SEARCH_CONFIG` and plugins `README.md`
