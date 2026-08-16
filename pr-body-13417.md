# What this PR does

Closes out the remaining gaps of #13417 (Message Queue for Agent & Chat). The core follow-up queue (send-while-streaming → queue, sequential auto-send on completion, drag-reorder, inline edit, per-item delete, pause/resume, per-conversation scope, Chat + Agent) already landed earlier; this PR implements the pieces of the original spec that were still missing:

- **Expand / collapse**: the queue dock now shows up to 3 messages by default; additional messages collapse behind an "Expand N more…" toggle (`QueuedFollowupsDock` + `ReorderableList.visibleItems`, which keeps drag-reordering intact for the visible subset).
- **Clear Queue**: a header trash action drops every pending message at once.
- **Failure handling (Skip / Retry / Abort)**: when the head message fails to send (rejects or resolves false), the queue auto-pauses and a banner appears with Skip / Retry / Abort remaining. Skip drops the failed head and continues with the next message; Retry re-sends it (only dequeues on success); Abort clears the rest of the queue. A failure never auto-re-drains on its own.
- **Queue limit**: per-conversation cap of 20 queued messages (`QUEUE_LIMIT`); attempting to exceed it shows a "Queue full" toast and leaves the draft untouched.
- **Restart persistence**: the queue moves from the per-window memory cache (`cacheService.setCasual` + 24 h TTL) to the renderer persist cache (localStorage) under the new schema key `ui.composer.followup_queue` (typed `FollowupQueues` in `cacheValueTypes.ts`). Pending follow-ups now survive app restarts; entries are dropped once drained and unpaused to keep storage bounded.

# Why we need it and why it was done in this way

- **Skip/Retry/Abort as an in-dock banner** instead of a modal prompt: the queue dock already owns the failed head's context (preview + actions), so a compact banner keeps the interaction local, and the queue stays fully visible while the user decides. The three actions map 1:1 to the spec's Skip / Retry / Abort.
- **Persist tier over casual cache**: `usePersistCache`-backed keys are the repo's established restart-persistent tier (same as `ui.composer.input_history`); the queue's serialized payloads (`ComposerQueuedMessagePayload`, loosely typed in shared) are already JSON-safe.
- **`ReorderableList.visibleItems` for collapse**: the UI package already supports rendering a subset while mapping drag positions back into the full list (`reorderVisibleSubset`), so collapsed dragging cannot lose items.
- The drain effect reads paused/failure state through refs to avoid effect re-runs and stale-state races; `removeId` resolves a failed head atomically inside one state updater.

Tradeoffs: `failedItemId` is per-window state (not persisted), so a failure mid-restart leaves the queue paused with the head intact rather than a stale banner. The expand state is view-local (resets when the queue empties).

Alternatives considered: a modal Skip/Retry/Abort dialog (rejected — heavier than needed for a dock-owned failure); persisting `failedItemId` (rejected — a stale failure banner across restarts is worse than a paused queue).

Discussion: https://github.com/CherryHQ/cherry-studio/issues/13417

# Breaking changes

None. The queue storage key changes from the casual memory cache to the persist cache; pending queues that existed only in memory are not migrated (they were already lost on restart by design).

# Special notes for your reviewer

- The queue keeps working identically in Chat and Agent mode; both composers were wired with the same props.
- The `@cherrystudio/ui` mock in `tests/renderer.setup.ts` was updated to honor `ReorderableList.visibleItems` (it previously ignored it), so collapsed-subset rendering is covered by tests.
- i18n: new keys added to `en-us` / `zh-cn`; the other locales carry `[to be translated]:` placeholders as per the translation workflow.

# Checklist

- [x] Branch: This PR targets `main`
- [x] PR: The PR description is expressive enough and will help future contributors
- [x] Code: Write code that humans can understand
- [x] Refactor: You have left the code cleaner than you found it (Boy Scout Rule)
- [x] Upgrade: Impact of this change on upgrade flows was considered and addressed if required
- [x] Documentation: A user-guide update was considered — not required for these UI refinements
- [x] Self-review: I have reviewed my own code before requesting review

# Release note

```release-note
Follow-up message queue: add expand/collapse, Clear Queue, Skip/Retry/Abort on send failure, a 20-message per-conversation limit, and restart persistence.
```
