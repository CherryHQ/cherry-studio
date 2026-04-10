# @cherrystudio/ai-core

## 2.0.0

### Major Changes

- [#12235](https://github.com/CherryHQ/cherry-studio/pull/12235) [`1c0a5a9`](https://github.com/CherryHQ/cherry-studio/commit/1c0a5a95faeea8a9b55e1ae647bc55692d167aec) Thanks [@DeJeune](https://github.com/DeJeune)! - Migrate to AI SDK v6 - complete rewrite of provider and middleware architecture

  - **BREAKING**: Remove all legacy API clients, middleware pipeline, and barrel `index.ts`
  - **Image generation**: Migrate to native AI SDK `generateImage`/`editImage`, remove legacy image middleware
  - **Embedding**: Migrate to AI SDK `embedMany`, remove legacy embedding clients
  - **Model listing**: Refactor `ModelListService` to Strategy Registry pattern, consolidate schema files
  - **OpenRouter image**: Native image endpoint support via `@openrouter/ai-sdk-provider` 2.3.3
  - **GitHub Copilot**: Simplify extension by removing `ProviderV2` cast and `wrapProvider`
  - **Rename**: `index_new.ts` → `AiProvider.ts`, `ModelListService.ts` → `listModels.ts`

### Patch Changes

- [#13787](https://github.com/CherryHQ/cherry-studio/pull/13787) [`6b4c928`](https://github.com/CherryHQ/cherry-studio/commit/6b4c92805679e00440c7610c82bdf02eb4916b1a) Thanks [@EurFelux](https://github.com/EurFelux)! - Add missing @openrouter/ai-sdk-provider dependency to fix package build

- [#12783](https://github.com/CherryHQ/cherry-studio/pull/12783) [`336176b`](https://github.com/CherryHQ/cherry-studio/commit/336176be086c8294d9aa21da9ce83242af8aa9a8) Thanks [@EurFelux](https://github.com/EurFelux)! - Baseline release for previously unmanaged package changes while introducing changesets-based publishing

- Updated dependencies [[`336176b`](https://github.com/CherryHQ/cherry-studio/commit/336176be086c8294d9aa21da9ce83242af8aa9a8)]:
  - @cherrystudio/ai-sdk-provider@0.1.6
