---
description: Native file observation ownership, invalidation subscriptions, directory leases, and renderer recovery
sources:
  - src/main/services/file/observation
  - src/main/ipc/handlers/fileObservation.ts
  - src/shared/ipc/schemas/fileObservation.ts
  - src/renderer/services/fileObservation
  - src/renderer/hooks/useFileObservation.ts
---

# File Observation

English | [中文](file-observation.zh.md)

## Ownership

Main `FileObservationService` is a `WhenReady` lifecycle service depending on `WindowManager` and `PowerService`. It owns native scopes and file subscriptions. Its private `WatchScope` wraps the existing chokidar adapter and readiness promise. Directory builders receive the service explicitly and consume leases; disposing a projection releases only its lease.

Equivalent scope keys share native resources. Tree keys include the root, depth and filtering policy; projection-only extension and stats options do not require separate native scopes. Explicit-file keys include the requested file and existing parent used for watching. File scopes prune unrelated paths and observe parent relationships so replacement, deletion and recreation remain visible. Resolved targets and symlink bindings have separate scopes; binding changes invalidate coverage and require rebinding. They do not inherit the tree's hidden-file or gitignore exclusions. Sharing does not widen observation to an entire unused workspace.

Scopes close when their final lease is released. Window destruction releases that window's file subscriptions; directory consumers have their own cleanup. Service shutdown stops admission and awaits native closure. Observation owns no file bytes, drafts, persistent records or write leases.

## File protocol

The shared schema owns all transport types. The IPC adapter requires a managed sender and resolves entry handles through `FileManager`; path handles use the existing absolute-path contract.

| Route or event | Contract |
|---|---|
| `file.observe.open` | Acquire ready coverage and return a subscription ID, baseline revision and coverage; no content read |
| `file.observe.activate` | After installing the listener, activate the owned baseline; replay a coalesced invalidation received during handoff |
| `file.observe.changed` | Directed invalidation containing the subscription ID, latest revision and `live`, `stale` or `unavailable` coverage |
| `file.observe.close` | Idempotently release an owned subscription; another window cannot release it |

Revisions order invalidations within one subscription, not filesystem writes. Buffered invalidations can coalesce, so a revision jump requires revalidation rather than replaying a supposed change journal. Notifications do not carry coherent bytes or acknowledge saves. Existing read and conditional-write routes remain authoritative.

## Renderer consumers

The window-local `fileObservationService` registry shares a `FileObservationSession` for the same exact handle. React uses `useFileObservation`; editing sessions subscribe directly. Drafts and undo remain separate across editing owners even when their observation is shared.

The canonical `FilePreview` host acquires observation before reading metadata and content. An invalidation changes the source generation, including for equal-length writes and unchanged metadata. Existing plugin/source cancellation rejects superseded reads and selections; already-issued IPC cannot be physically cancelled. Plugins retain compatible reading state and do not create watchers.

Renderer subscriptions retain a ten-second idle grace period. Returning after release establishes new coverage. Focus and visible-document transitions invalidate live content or retry unavailable coverage. Detached drafts release their subscription after their own bounded grace once saves settle, while retaining draft recovery; conditional saves still validate the baseline.

## Failure and recovery

Initial setup can fail; `unavailable` is distinct from a missing file or empty content. Watcher errors invalidate coverage, and system resume marks active scopes stale. Directory builders publish a status mutation before disposal; directory sessions take a new snapshot. File sessions release the obsolete subscription and reconnect, with at most three activation attempts. An acquisition failure or exhausted activation leaves an explicit error and can retry on focus/visibility return.

Live coverage means the observation channel is active, not that a consumer has completed its latest read. File consumers guard reads against their observation version and local draft/read generations. The guarantee depends on receiving an invalidation or an explicit recovery trigger and successfully rereading. There is no periodic full-workspace scan, lossless filesystem journal, or fixed refresh-latency guarantee for silent OS event loss.
