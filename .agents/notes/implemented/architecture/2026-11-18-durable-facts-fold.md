# Agent Note: Derive Durable behavior facts and observations as folds

Status: implemented

English | [中文](2026-11-18-durable-facts-fold.zh.md)

## Problem

Pi Durable consumers derived current state by recomputing it from the committed log, and Cherry repeated this at several layers. The #24500 workload (one session with about 5,500 history entries, more than 12 subagents and inline images) made each recompute expensive and frequent:

- **Behavior facts.** [`agent-behavior`](../../proposed/architecture/2026-10-18-agent-behavior-package.md) defines facts as the full-lineage history, the keys already seen and the direct children's facts. The Durable adapter built them on every read. Since #24714 it read only newer entries, but each read still:
  - scanned every task of the conversation and of each child;
  - recomputed the history from all cached entries;
  - for each child, looked up a submission per reserved run and summed the child's whole history.

  A read ran on every tool call (the approval gate), two to four times per behavior step, at each submit and in the subagent message, answer and stop paths. The message and answer paths also scanned the child's complete history, images included, outside any cache.
- **Runtime observation.** The adapter recomputed `historyOf` over the loaded history on every commit publication and live preview. It published a full snapshot for every update, although the observation contract also has `message.upsert`, `message.remove` and `input.changed`.
- **Main projections.** Every update was a snapshot, so Main parsed its context row once per historical input on each update. `ChildThreadProjection` reread, redecorated and rewrote each active child's archive and checkpoint on every flush.

The cache added in #24714 reduced entry reads but kept the recompute, and it lived as long as the runtime without eviction.

The guarantees behind this design do not require a recompute per event:

- a decision and its writes in one commit;
- at-most-once keyed operations;
- recovery from the log alone;
- recovery from observation gaps.

`agent-behavior` already states the property an incremental implementation needs, as replay invariant I3: an incremental cache equals a full recompute.

## Decision

Each derived state is a fold of the log with a cursor: a reducer applied to each new entry and task in commit order. A rebuild applies the same reducer from empty, so the incremental result equals the rebuild by construction, and a fold can be dropped at any time without affecting results. Folds live in memory only; the log stays the only authority.

### P1 — Behavior facts in the Durable adapter (#24814)

- **One fold per conversation.**
  - The runtime's Session owns the folds; the behavior harness and the runtime share them.
  - A fold holds the history, the key set, child IDs, origin and plan records, tool-task call keys, run IDs, run reservations and usage per run, each run's last reply, and the latest assistant call set.
  - It keeps no entry bodies or images.
- **Catch-up inside the transaction.** Before a read, the fold advances in three steps:
  - It reads entries newer than its cursor.
  - It reads tasks newer than the newest one it has seen, newest first, per lineage conversation. Task IDs are minted in commit order on one mutation line, and tasks are never deleted.
  - It point-reads only state that can still change: unfinished behavior jobs, the newest generation task and reservations whose submission has no run yet.

  `LiveDoc`, `InboxDoc` and the summary documents stay point reads. A transaction cannot read after its own writes (`ReadAfterWrite`), so a fold only advances to committed state.
- **Late tool tasks.** A sequential tool round creates later calls' tasks after their assistant entry. Such a task updates that call's key in place, together with any tool result that resolved its key through that call.
- **Facts.** `readFacts` assembles `ConversationFacts` from the folds of the conversation and its direct children. The facts shape and the decision code are unchanged.
- **Narrow readers.**
  - The tool gate reads plan, goal round and call window from its own conversation's fold, without children.
  - A step's append validation point-reads only whether a quiet input's target is idle.
  - The subagent message, answer and stop paths read the child's fold instead of its history.
- **Lifetime.** A fold unused for 10 minutes is dropped on the next read; closing the Session drops every fold.

### P2 — Runtime observation (#24817)

- The runtime's published history reuses the conversation's fold instead of recomputing `historyOf` per publication and preview.
- The adapter publishes a `snapshot` on the first publication, after a `gap` and when a run starts, because Main detects autonomous turns from those snapshots. Every other update publishes only `message.upsert`, `message.remove` and `input.changed` for what it changed, and an activity change, including a run end, adds `activity.changed`. An update whose changes cannot reproduce the new message order publishes a snapshot instead. Completion rides the last frame of its update.

### P3 — Main projections (#24818)

- Main handles the inputs an update changed, not every input of a snapshot.
- `ChildThreadProjection` keeps its archive read triggers, because Claude Code and Pi children share it and only Durable live IDs equal archive IDs. Its committed projection persists across reads, so a read redecorates only messages whose source changed, and the checkpoint and response owners are written only when they change. A message is saved only when it differs from its stored row as that row reads back from JSON, where undefined fields are absent, so reopening a child rewrites nothing; opening reads the archive once.
- A run end reaches Main as `activity.changed`, which carries the completion. A run start keeps its snapshot: Durable delivers each observation event as its own batch, so a delta run start would let Main project the run's content and place a steer before it begins the autonomous turn.

### Out of scope

- Message part storage and keyed renderer subscriptions: the #24019 stack.
- Image and oversized tool-output storage: #24650 and #23873.
- In-process gateway dispatch, which #24650 deferred.
- The Pi adapter, whose facts read an in-memory branch, not storage.
- Storing the context checkpoint as rows. It is written once per turn and per later amendment, and the child projection no longer rewrites it on every flush.

## Alternatives considered

- **Keep the #24714 cache and bound its lifetime.** It caches the fold's input, not its result: every read still recomputes the history and rescans tasks, child submissions and child usage.
- **Persist the folds as Durable documents written in the same commit.** They would survive a restart, but facts include the full history, so each commit would rewrite a large document, and every Durable writer would have to maintain them. Rebuilding once per Session costs less than writing on every commit.
- **Replace `Ledger.read` with per-call queries.** This breaks the rule that decisions depend only on facts, and changes `agent-behavior` and both adapters. The fold keeps the contract and removes the cost.
- **Advance the folds from `observeCommits`.** A publication arrives a macrotask after storage, so a transaction can start before its fold has seen the previous commit. Catching up inside the transaction is exact and costs one bounded scan.

## Consequences

- The first read of a conversation in a Session, or after 10 idle minutes, rebuilds its fold from the log; later reads cost only the rows committed since.
- A fold defect gives wrong facts rather than slow ones. Folds are not persisted, so dropping them repairs any state found wrong later.
- The newest-first task scan relies on Durable minting task IDs in commit order, as entry reads already do. A Durable version that admits commits out of order would need a commit cursor for tasks.
- A child run's usage adds its entry usage as one sum after the summary usage, so `costUsd` can differ from the previous order in the last floating-point digit when that run has native compaction summaries.
- Observers must read a run's final content from its upserts or the replayed view, not from a run-end snapshot.
- On the #24500 workload shape, main-process allocation falls by a third and peak heap by 35%. The renderer's message-list reads, retained heap growth of about 43 MB per round and per-round reads that grow with accumulated child tasks remain.
- This note moved to implemented before Spec PR #24813 received an approving review, at the author's direction.

## Verification

- AC1 — `tests/factsFold.test.ts` runs every applicable `agent-behavior` contract case and compares the warm fold with one rebuilt from empty in the same transaction at every read, with no mismatch; `tests/history.test.ts` checks that a late tool task gives the same keys in any fold order and that warm and empty folds read equal facts, including a read limited to an earlier entry; disabling the late-task key rewrite fails both (#24814).
- AC2 — `tests/factsFold.test.ts` "reads only unseen rows on repeated facts reads and on the child answer and stop paths": through a counting transaction, a repeated read reads 0 entries, 0 task point reads, 0 submissions and at most one task row per lineage conversation, and a read after one appended entry reads 1 entry (#24814).
- AC3 — The same test reads 0 entries for `awaitAnswer` and `stop` on a settled child, and the contract suite shows unchanged results; the tool gate advancing only its own fold, quiet-input validation reading only `LiveDoc` and `InboxDoc`, and the message path are covered by code inspection of `src/behavior/harness.ts`, not by a counting test (#24814).
- AC4 — A fold used within 10 minutes stays warm (0 entries read), and one unused for longer is rebuilt (3 entries read) with equal facts; the Session-close clear in `runtime.ts` has no runtime-level test (#24814).
- AC5 — `pnpm exec vitest run --project agent-runtime-pi-durable` passes on each layer: 17 files, 172 passed on #24814 and 175 passed on #24817 and #24818, with 6 skipped (the three unsupported contract cases in each of the two contract runs).
- AC6 — `tests/projection.test.ts` checks that a preview, a tool-call preview, its committed entry and a tool result arrive as `message.upsert` frames after the baseline snapshot and replay to the rebuilt view, that the frame after `gap` is a snapshot and that completion rides its update's last frame; `tests/runtime.test.ts` checks partial upserts for streamed text, and `tests/history.test.ts` checks that the fold's history equals `historyOf` (#24817).
- AC7 — `ChildThreadProjection.test.ts` checks that an unchanged read decorates and saves nothing, an appended message is the only one decorated, `refreshDecoration` redecorates only its message, a reopened projection renders the same messages, and a reopened archive whose tool output holds an undefined field saves no message; the Main suites check inputs bound once across flushes, input state reported once per run, and a run end that releases a background child, keeps its answer and stops steers; 13 Main files, 281 passed, 2 skipped; on the #24500 profile copy after 6 rounds, a relaunch rewrites 0 instead of 923 child messages and samples 6,781 instead of 9,952 MB in the restore window (#24818).
- AC8 — Development Electron runs of the #24500 shape (6 rounds of 4 subagents each reading 5 images of about 1 MB, with a local mock model) against stack base `791fbb6`: sampled main-process allocation 39,912 → 26,858 MB, peak heap 3,023 → 1,957 MB, tasks read 668,204 → 19,823 and entry reads 19,722 → 11,250; by call site, Durable storage reads fall from 9.5 to 3.9 GB, Drizzle row reads from 13.5 to 8.9 GB and the Durable projection package from 1,014 to 91 MB (#24818).
- AC9 — The Durable package README, `src/main/ai/runtime/piDurable/README.md` and `docs/dev/references/ai/agent-session-runtime.md` describe the folds, the snapshot and delta rules and the run-end `activity.changed`; this triplet moved to implemented, and `pnpm docs:check` and `pnpm agent-notes:check-transition` pass.
