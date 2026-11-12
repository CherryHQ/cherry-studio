# @cherrystudio/web-search

## Unreleased

### Patch Changes

- Change the package license from AGPL-3.0-only to MIT and update the README license statement.

## 0.8.0

### Minor Changes

- [#21426](https://github.com/CherryHQ/cherry-studio/pull/21426) [`1350943`](https://github.com/CherryHQ/cherry-studio/commit/135094397393a867072f6f73520c91b950312171) Thanks [@Nolikzero](https://github.com/Nolikzero)! - Add the SerpKite keyword search provider.

### Patch Changes

- [#24234](https://github.com/CherryHQ/cherry-studio/pull/24234) [`2e65759`](https://github.com/CherryHQ/cherry-studio/commit/2e6575901a59e6edb5748a2df18713f48635f658) Thanks [@DeJeune](https://github.com/DeJeune)! - Standardize public libraries on MIT and include package-local license files.

## 0.7.0

### Minor Changes

- [#24181](https://github.com/CherryHQ/cherry-studio/pull/24181) [`5313170`](https://github.com/CherryHQ/cherry-studio/commit/53131700862e0b357530935cfcc1a9e83544f2fa) Thanks [@404-Page-Found](https://github.com/404-Page-Found)! - Add a portable StepFun keyword-search provider with host-owned transport and credentials.

## 0.6.0

### Minor Changes

- [#24077](https://github.com/CherryHQ/cherry-studio/pull/24077) [`082f62f`](https://github.com/CherryHQ/cherry-studio/commit/082f62f5913841c9f674b61479b8b6fe45b494fc) Thanks [@NatsUIJM](https://github.com/NatsUIJM)! - Add URL fetching to the Exa provider through the Contents API.

## 0.5.0

### Minor Changes

- [#21987](https://github.com/CherryHQ/cherry-studio/pull/21987) [`a65a51f`](https://github.com/CherryHQ/cherry-studio/commit/a65a51f848eb2bc8c89aa6403524b152071a0ed7) Thanks [@Chkhikvadze](https://github.com/Chkhikvadze)! - Add the Desearch web search provider for keyword search.

## 0.4.0

### Minor Changes

- [#22599](https://github.com/CherryHQ/cherry-studio/pull/22599) [`b8e6bca`](https://github.com/CherryHQ/cherry-studio/commit/b8e6bca0423b618819b8082204db0f4b6b798b70) Thanks [@sgan0420](https://github.com/sgan0420)! - Add the SearchApi provider for Google keyword search with bearer API key authentication.

## 0.3.1

### Patch Changes

- [#22793](https://github.com/CherryHQ/cherry-studio/pull/22793) [`1cd6601`](https://github.com/CherryHQ/cherry-studio/commit/1cd6601053084d2b50296a7cd929138657679b23) Thanks [@cherry-coding](https://github.com/apps/cherry-coding)! - Report attributable Querit page crawl failures as provider/page_fetch_failed, preserving request-error precedence and status-less content compatibility.

## 0.3.0

### Minor Changes

- [#22343](https://github.com/CherryHQ/cherry-studio/pull/22343) [`4844b32`](https://github.com/CherryHQ/cherry-studio/commit/4844b32d0aa306a75c82bfaa8d243325e7f1325e) Thanks [@WhiteZeek](https://github.com/WhiteZeek)! - Add the Tencent Yuanbao Search provider with service API key authentication, ranked search results, result-count and domain-exclusion parameters, and provider error handling.

### Patch Changes

- [#22102](https://github.com/CherryHQ/cherry-studio/pull/22102) [`c1eaadc`](https://github.com/CherryHQ/cherry-studio/commit/c1eaadc3e46cf193aeacca344625fcd0972cae65) Thanks [@cherry-coding](https://github.com/apps/cherry-coding)! - Set Crawl4AI Cloud as the default URL fetch endpoint while preserving self-hosted overrides.

## 0.2.0

### Minor Changes

- [#21909](https://github.com/CherryHQ/cherry-studio/pull/21909) [`5481762`](https://github.com/CherryHQ/cherry-studio/commit/54817627d326f0e23e967ae2aac71c74266f8ce5) Thanks [@angri450](https://github.com/angri450)! - Add the DeepSeek Search and Fetch provider, preserving complete Unicode characters when limiting search queries.

## 0.1.0

### Minor Changes

- [#21807](https://github.com/CherryHQ/cherry-studio/pull/21807) [`48d529d`](https://github.com/CherryHQ/cherry-studio/commit/48d529d3e05d46fe47ed7904b466d03923ec9f0e) Thanks [@zhangjiadi225](https://github.com/zhangjiadi225)! - Introduce portable web-search provider protocols, host-injected networking, structured errors, and optional URL filtering and content slicing. Preserve Desktop orchestration through host adapters and expose explicit per-provider entry points for Mobile consumers.
