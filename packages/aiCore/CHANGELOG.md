# @cherrystudio/ai-core

## 1.1.0

### Minor Changes

- [#12235](https://github.com/CherryHQ/cherry-studio/pull/12235) [`1c0a5a9`](https://github.com/CherryHQ/cherry-studio/commit/1c0a5a95faeea8a9b55e1ae647bc55692d167aec) Thanks [@DeJeune](https://github.com/DeJeune)! - Remove unused exports, dead types, and over-engineered abstractions from aiCore

  - Remove unused public exports: `createOpenAICompatibleExecutor`, `create*Options`, `mergeProviderOptions`, `PluginManager`, `createContext`, `AI_CORE_VERSION`, `AI_CORE_NAME`, `BUILT_IN_PLUGIN_PREFIX`, `registeredProviderIds`, `ProviderInitializationError`, `ProviderExtensionBuilder`, `createProviderExtension`
  - Delete dead type definitions: `HookResult`, `PluginManagerConfig`, `AiRequestMetadata`, `ExtractProviderOptions`, `ProviderOptions`, `CoreProviderSettingsMap` (re-added as internal), `ExtractExtensionIds`, `ExtractExtensionSettings`
  - Remove over-engineered `ExtensionStorage` system: delete `ExtensionStorage`, `StorageAccessor`, `ExtensionContext`, `ExtensionHook`, `LifecycleHooks` types; remove `TStorage` generic parameter from `ProviderExtension` (4 → 3 type params); remove `_storage`, `storage` getter, `createContext`, `executeHook`, `initialStorage`, `hooks` from class and config
  - Delete `create*Options` convenience functions and inline `createOpenRouterOptions` at its only call site
  - Delete `DEFAULT_WEB_SEARCH_CONFIG` and plugins `README.md`

### Patch Changes

- [#13787](https://github.com/CherryHQ/cherry-studio/pull/13787) [`6b4c928`](https://github.com/CherryHQ/cherry-studio/commit/6b4c92805679e00440c7610c82bdf02eb4916b1a) Thanks [@EurFelux](https://github.com/EurFelux)! - Add missing @openrouter/ai-sdk-provider dependency to fix package build

- [#12783](https://github.com/CherryHQ/cherry-studio/pull/12783) [`336176b`](https://github.com/CherryHQ/cherry-studio/commit/336176be086c8294d9aa21da9ce83242af8aa9a8) Thanks [@EurFelux](https://github.com/EurFelux)! - Baseline release for previously unmanaged package changes while introducing changesets-based publishing

- Updated dependencies [[`336176b`](https://github.com/CherryHQ/cherry-studio/commit/336176be086c8294d9aa21da9ce83242af8aa9a8)]:
  - @cherrystudio/ai-sdk-provider@0.1.6
