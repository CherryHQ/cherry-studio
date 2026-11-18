# Agent Note: Derive Durable behavior facts and observations as folds

Status: proposed

English | [中文](2026-11-18-durable-facts-fold.zh.md)

## Problem

Pi Durable consumers derive current state by recomputing it from the committed log, and Cherry repeats this at several layers. The #24500 workload (one session with about 5,500 history entries, more than 12 subagents and inline images) makes each recompute expensive and frequent:

- **Behavior facts.** [`agent-behavior`](2026-10-18-agent-behavior-package.md) defines facts as the full-lineage history, the keys already seen and the direct children's facts. The Durable adapter builds them on every read. Since #24714 it reads only newer entries, but each read still:
  - scans every task of the conversation and of each child;
  - recomputes the history from all cached entries;
  - for each child, looks up a submission per reserved run and sums the child's whole history.

  A read runs on every tool call (the approval gate), two to four times per behavior step, at each submit and in the subagent message, answer and stop paths. The message and answer paths also scan the child's complete history, images included, outside any cache.
- **Runtime observation.** The adapter recomputes `historyOf` over the loaded history on every commit publication and live preview. It publishes a full snapshot for every update, although the observation contract also has `message.upsert`, `message.remove` and `input.changed`.
- **Main projections.** Every update is a snapshot, so Main parses its context row once per historical input on each update. `ChildThreadProjection` rereads, redecorates and rewrites each active child's archive and checkpoint on every flush.

The cache added in #24714 reduces entry reads but keeps the recompute, and it lives as long as the runtime without eviction.

The guarantees behind this design do not require a recompute per event:

- a decision and its writes in one commit;
- at-most-once keyed operations;
- recovery from the log alone;
- recovery from observation gaps.

`agent-behavior` already states the property an incremental implementation needs, as replay invariant I3: an incremental cache equals a full recompute.

## Proposal

Each derived state becomes a fold of the log with a cursor: a reducer applied to each new entry and task in commit order. A rebuild applies the same reducer from empty, so the incremental result equals the rebuild by construction, and a fold can be dropped at any time without affecting results. Folds live in memory only; the log stays the only authority.

### P1 — Behavior facts in the Durable adapter

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
- **Facts.** `readFacts` assembles `ConversationFacts` from the folds of the conversation and its direct children. The facts shape and the decision code do not change.
- **Narrow readers.**
  - The tool gate reads plan, goal round and call window from the fold, without children.
  - A step's append validation reads only whether a quiet input's target is idle.
  - The subagent message, answer and stop paths read the child's fold instead of its history.
- **Lifetime.** A fold unused for 10 minutes is dropped on the next read; closing the Session drops every fold.

### P2 — Runtime observation

- The runtime's published history reuses the conversation's fold instead of recomputing `historyOf` per publication and preview.
- Between a baseline snapshot and the next gap, the adapter publishes `message.upsert`, `message.remove` and `input.changed` for what a commit changed. It publishes a `snapshot` when observation starts and after a `gap`.

### P3 — Main projections

- Main handles the inputs an update changed, not every input of a snapshot.
- `ChildThreadProjection` rereads the child archive only on `snapshot`, `gap` or `mapping-reset`, and otherwise applies upserts and removals. Recompute and compare remains the recovery path for those three events.

### Out of scope

- Message part storage and keyed renderer subscriptions: the #24019 stack.
- Image and oversized tool-output storage: #24650 and #23873.
- In-process gateway dispatch, which #24650 deferred.
- The Pi adapter, whose facts read an in-memory branch, not storage.
- Storing the context checkpoint as rows. It is written once per turn and per later amendment; after P3 the child projection no longer rewrites it on every flush.

## Alternatives considered

- **Keep the #24714 cache and bound its lifetime.** It caches the fold's input, not its result: every read still recomputes the history and rescans tasks, child submissions and child usage.
- **Persist the folds as Durable documents written in the same commit.** They would survive a restart, but facts include the full history, so each commit would rewrite a large document, and every Durable writer would have to maintain them. Rebuilding once per Session costs less than writing on every commit.
- **Replace `Ledger.read` with per-call queries.** This breaks the rule that decisions depend only on facts, and changes `agent-behavior` and both adapters. The fold keeps the contract and removes the cost.
- **Advance the folds from `observeCommits`.** A publication arrives a macrotask after storage, so a transaction can start before its fold has seen the previous commit. Catching up inside the transaction is exact and costs one bounded scan.

## Acceptance criteria

- AC1 — After every commit of scripted Durable histories (tool rounds whose later tool tasks follow their assistant entry, a fork, child runs with reservations, compaction summaries and behavior jobs), facts read through a warm fold equal facts read through an empty one, including reads limited to an earlier entry. (verification: unit — Durable history tests)
- AC2 — A repeated facts read with no new commit reads no entries, at most one task per lineage conversation and no child entries, and a read after a commit reads only that commit's rows; neither depends on the history length or on the children's history. (verification: unit — counting transaction)
- AC3 — The tool gate reads only its own conversation's fold, a step's append validation reads no entries or tasks, and the subagent message, answer and stop paths read only child entries their fold has not seen; their results are unchanged. (verification: unit — counting transaction and the contract suite)
- AC4 — A fold unused for 10 minutes is dropped and rebuilt with equal facts on its next read. (verification: unit)
- AC5 — The `agent-behavior` contract suite on Pi Durable and the Durable package suites pass. (verification: unit)
- AC6 — Between a baseline and a gap, a Durable observation publishes only the messages and inputs a commit changed, its published history equals the fold's, and a gap or a new observation starts with a snapshot. (verification: unit — Durable projection and runtime tests)
- AC7 — Main processes only the inputs an update changed, and an active child's archive is reread only on snapshot, gap or mapping reset, with unchanged product rows and checkpoints in the existing child scenarios. (verification: unit — Main agent-session suites)
- AC8 — The #24500 workload shape runs in a development Electron build, and the report records main-process heap and allocation by call site against the stack base. (verification: Electron)
- AC9 — The Durable README, `agent-session-runtime.md` and this note's triplet describe the shipped fold semantics. (verification: docs gate)

## Risks

- A fold defect gives wrong facts rather than slow ones. AC1 compares every commit with a rebuild, and because folds are not persisted, dropping them repairs any state found wrong later.
- The newest-first task scan relies on Durable minting task IDs in commit order, as entry reads already do. A Durable version that admits commits out of order would need a commit cursor for tasks.
- A child run's usage now adds its entry usage as one sum after the summary usage, so `costUsd` can differ from the previous order in the last floating-point digit when that run has native compaction summaries.
- P3 depends on P2's delta stream; until P2 ships, Main keeps receiving snapshots and P3 does not change its cost.
