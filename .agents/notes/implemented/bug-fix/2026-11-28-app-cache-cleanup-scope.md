# Agent Note: App cache cleanup preserves installed dependencies

Status: implemented

English | [中文](2026-11-28-app-cache-cleanup-scope.zh.md)

## Problem

App cache cleanup omitted the Agent browser, legacy browser and mini-app partitions. The separate Browser settings action cleared HTTP cache and left CacheStorage and generated code behind. The application also accumulated downloadable toolchain data, but some installed CLIs linked directly into aube's shared dependency store under the cache directory.

## Decision

Use Electron's cache-specific operations for existing browser and mini-app partitions. Browser settings and App cache share the Agent browser cleanup operation. The browser can regenerate HTTP responses, CacheStorage and compiled code while retaining cookies, history and persistent site storage.

Allowlist the Cherry-owned mise cache, npm content cache and aube package metadata. Skip those directories when BinaryManager's mutation lock is held and report partial completion. Keep the aube shared store, uv cache and installed tool trees available to their consumers.

## Alternatives considered

- Clearing all Chromium site data would discard cookies and persistent website state.
- Removing the entire toolchain cache root would break dependencies that use absolute links into aube's shared store.

## Consequences

App cache includes more rebuildable data. Subsequent browsing, installation or updates can download it again. A tool mutation in progress can require a later retry of the cache cleanup.

## Verification

- Regression — focused main-process tests cover partition discovery, preserved site data, toolchain target ownership and cleanup during an active tool mutation.
- Regression — a macOS data copy shrank from 8.92 GiB to 6.79 GiB after the Agent browser and three toolchain cache targets were cleared. The tested installed-tool and shared dependency trees retained their sizes.
- Regression — the Electron settings workflow cleared CacheStorage in legacy and mini-app partitions while preserving their cookies and local storage, and preserved the cache in an unrelated partition.
