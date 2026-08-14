# Steer-Queue State-Machine Consolidation (design)

Status: **blockers 1–3 implemented** on `codex/main-3-ai-stream-steer-queue`
(`71ffd6f88d`, CI green); **blocker 4 handed off** to the renderer slice.
Surfaced by the fresh-eyes review of the steer-queue PR (#15935, at `e3dcc0e9a`).
Required review items **1–3 share one root cause**; secondary item S5 was removed
for free with `lastTerminalKind`. Dovetails with
[`tool-approval-state-consolidation.md`](./tool-approval-state-consolidation.md) —
the approve-gate (item 2) is that doc's "Phase 3" seen from the steer side.

**What landed** (`refactor(ai-stream): consolidate steer state machine on stream.status`):

- Deleted `lastTerminalKind`; `enqueuePendingSteer` reads `stream.status` on the in-grace
  stream (live→queue; done/no-stream→queue+schedule; awaiting-approval→queue without
  scheduling; aborted/error→drop) — closes the late-steer drops (blocker 1, variants A/B/C).
- The chaining gate keys off `stream.status === 'done'`, not `topicDone` — a multi-model
  turn that resolved to error never chains, in either settle order (blocker 3).
- `send()` throws instead of inject-dropping a prepared turn onto a live topic; under the
  per-topic dispatch lock this closes the approve-gate TOCTOU, and the approval handler
  catches it → `{ ok: false }` (blocker 2). The cheap `hasLiveStream` pre-check stays.
- Removing `lastTerminalKind` also drops its unbounded per-prompt-stream growth (secondary S5).
- Tests: variant A (chaining-window late steer), variant B (post-park steer), multi-model
  error in both settle orders, the inject-refusal.

**Handed off — blocker 4** (a chained same-model continuation reuses the prior turn's
`executionId`, so the renderer's terminal-replay map + readers collide and drop the
continuation's live chunks): unreachable in this slice (the composer blocks busy submits),
and it lives in `useExecutionOverlay` / `TopicStreamSubscription`, which are byte-identical
on `feat/chat-page`. Fix it in the renderer slice (key replay/readers by
`executionId + anchorMessageId`, or unregister-and-recreate on the chained `onCreated`, or
mint a turn-unique `executionId`).

**Not done — secondary S2** (track pending-approval `toolCallId`s as a set rather than the
single `exec.awaitingApproval` bool): left as a follow-up; the consolidation didn't require it.

The target design below is what shipped for blockers 1–3.

## Problem

The steer queue makes the same decision — *should this steer start a continuation
now, wait, or be dropped?* — at **three moments**, and each reads a **different
signal**:

1. the running turn's settle — `onExecutionDone`'s chaining gate (`AiStreamManager.ts:674`),
2. a steer that lands **after** settle — `enqueuePendingSteer` (`:515-539`),
3. an approval response that lands while/after the turn — the approve-gate
   (`AiService.ts:240`).

One of those signals, `lastTerminalKind`, is a **hand-maintained shadow** of the
topic's terminal disposition, and it is wrong in two structural ways.

### The signals today

| Signal | Real authority? | Written | Read | Hole |
|---|---|---|---|---|
| `lastTerminalKind: Map<topic, 'done'\|'aborted'\|'error'>` (`:213`) | **no** (a shadow) | `:586` (abort), `:680` (**clean-done only**), `:712`, `:754`, `:880` | `enqueuePendingSteer:520` | NOT written on the **chaining** settle or the **approval-park** settle → left `undefined`; the read treats `undefined` the same as `aborted`/`error` → **drop** |
| `stream.status` (`resolveTerminalStatus` → `computeTopicStatus`, `:1174`/`:1184`) | **yes** | every settle hook | several | already lives on the **in-grace** `ActiveStream` (lingers ~30 s after `runTerminalLifecycle`); correctly resolves multi-model mixes |
| `topicDone = !isLiveStatus(status)` (`:663`) | derived, **too loose** | — | chaining gate | `true` for `error`/`aborted`/`awaiting-approval` too, so it can't distinguish "clean" from "failed" |

`isLiveStatus` = `pending | streaming` only (`:154`); `done | aborted | error |
awaiting-approval` are all non-live, so the settled stream's `status` is a precise
4-way terminal disposition that **already exists** — `lastTerminalKind` is a lossy
duplicate of it.

### The bugs that fall out (review items)

- **Item 1 — late steer silently dropped.** A steer persisted during
  `prepareDispatch` lands in `enqueuePendingSteer` *after* the turn settled (the
  loop's terminal hooks don't hold the dispatch lock). On the **chaining** settle
  (`:680` skips recording) and the **approval-park** settle, `lastTerminalKind` is
  `undefined`, so the `:520` read drops it — even though the dispatch response
  already told the renderer success. Variants: A (chaining window), B
  (approval-park — contradicts the "queue waits for the post-approval continuation"
  design), C (continuation-start window).
- **Item 2 — approve-gate dodges the dispatch lock.** `AiService.ts:240` snapshots
  `hasLiveStream` *outside* the per-topic `dispatchLock`. A concurrent submit takes
  the lock and starts a live turn; the approval's `continue-conversation` then
  queues behind the lock, flips the anchor to `pending`, and `send()` inject-drops
  its models — approved tool never runs, row stuck `pending`, `{ ok: true }`
  returned. Same failure as the hole the gate closed, via the lock seam.
- **Item 3 — multi-model mixed terminal flips with settle order.** Exec A errors,
  exec B finishes clean last: `resolveTerminalStatus` → `stream.status = 'error'`,
  but the chaining gate keys off `topicDone` (`true`) and `:680` records
  `lastTerminalKind = 'done'`, so a queued steer **chains onto an errored topic**;
  reverse the settle order and the whole queue is dropped. One outcome, two
  behaviors, chosen by which exec settles last.

Plus: **item 4** (a chained continuation reuses the prior turn's `executionId` when
the model is unchanged → the renderer's terminal-replay map + readers collide and
drop the continuation's live chunks); **S2** (`exec.awaitingApproval` is a single
bool not keyed by `toolCallId`, so a sibling tool's output clears it mid-approval);
**S5** (`lastTerminalKind` is written for one-shot prompt streams too and only
cleared by a same-id `send()` → unbounded growth).

## Why this is a redesign, not three patches

Each window is "fixed" by recording a kind on one more path — but the signal stays
a shadow that must be written everywhere and read with an ambiguous `undefined`
(is it "clean, not yet recorded" or "non-clean"?). That is the same
fix-one-window-open-the-next treadmill the review is describing ("gaps in the
**interactions between** the patches"). The durable fix removes the shadow.

## Target design — one authority + pure projections

**Authority = the resolved `stream.status` of the in-grace `ActiveStream`**, plus
the `pendingSteers` queue and a pending-approval `toolCallId` set. No
`lastTerminalKind`.

> **Key invariant.** A settled chat stream lingers ~30 s (`runTerminalLifecycle`
> defers cleanup), so `activeStreams.get(topicId)?.status` is the authoritative
> terminal disposition for the *entire* steer race window. "No stream" = idle /
> fresh topic (the steer is really a new turn).

### 1. Delete `lastTerminalKind`

Every decision reads `stream.status` (or "no stream"). This also deletes **S5**
(no map to leak for prompt streams).

### 2. Chaining gate keys off the status, not `topicDone`

```ts
// onExecutionDone, after stream.status = resolveTerminalStatus(stream)
const chatChaining = stream.status === 'done' && this.hasPendingSteer(topicId)
```

`awaiting-approval` and `error`/`aborted` are excluded because they are not
`'done'` — so the multi-model mixed-error case (item 3) never chains, **regardless
of settle order**. (`approvalPending` as a separate recompute goes away — it's just
`status === 'awaiting-approval'`.)

### 3. `enqueuePendingSteer` becomes a pure function of the authority

```ts
const prev = this.activeStreams.get(topicId)
if (prev && isLiveStatus(prev.status)) { this.appendPendingSteer(...); return } // yields + chains
switch (prev?.status) {
  case undefined:            // idle/fresh topic — no recent turn
  case 'done':               this.appendPendingSteer(...); this.scheduleNextChatTurn(topicId); break // items 1A/1C
  case 'awaiting-approval':  this.appendPendingSteer(...); break  // queued; post-approval continuation drains it (item 1B)
  case 'aborted':
  case 'error':              /* drop: log, row stays resendable */ break
}
```

`undefined`/`done` → drain (the chaining/continuation windows now read `'done'` or
a live stream, never `undefined`). `awaiting-approval` → queue without scheduling.
`aborted`/`error` → drop. No ambiguous state remains.

### 4. Serialize the approve-gate through the `dispatchLock`

Acquire the existing per-topic `dispatchLock` in the approval-respond handler and
re-check liveness **under** it, so Approve and a concurrent submit can't interleave
(item 2). This is the steer-side of the approval doc's Phase 3 (single authoritative
writer + one serialization point); do them together.

### 5. Turn-unique `executionId` for chained continuations (item 4)

Mint a fresh `executionId` per dispatched turn (derive from the new placeholder
`messageId` / a per-topic turn counter) instead of reusing the prior turn's id when
the model is unchanged. The renderer's `#terminalByExecutionId` replay map and
`useExecutionOverlay`'s reader keys then never collide across chained turns — fixed
at the source rather than by special-casing the overlay. (If we instead keep the id
and key replay/readers by `executionId + anchorMessageId`, record that as the
renderer-slice hand-off.)

### Folds in

- **S2**: replace the single `exec.awaitingApproval` bool with a pending-approval
  `toolCallId` set on the execution; the chaining gate, the approve-gate, and the
  2 h idle re-arm all read it, so a sibling tool's output can't clear a still-pending
  approval.

## Invariants

- A queued/late steer is **answered exactly once or left resendable** — never
  silently dropped on a clean or approval-park settle, never chained onto an
  aborted/errored topic.
- The chain/drop decision is **identical regardless of multi-model settle order**.
- Approve never inject-drops a live continuation (serialized through the
  `dispatchLock`).
- A chained continuation's chunks render **live** (turn-unique `executionId`), not
  only after the terminal DB refresh.

## Validation

New tests: variant A (late steer in the chaining window → answered), variant B
(late steer during approval-park → queued, answered by the post-approval
continuation), multi-model A-error/B-done in **both** settle orders → no chain +
queue dropped, Approve racing a submit → serialized (no swallow, no `{ ok: true }`
over a dropped turn), same-model continuation → live chunks reach the overlay.

## Scope

`AiStreamManager` (`onExecutionDone`/`onExecutionPaused`/`onExecutionError`,
`enqueuePendingSteer`, `executionId` minting, delete `lastTerminalKind`),
`AiService` approve-gate (+ `dispatchLock`), and the per-execution pending-approval
set. The item-4 renderer fix lands here (unique `executionId`) or as an explicit
renderer-slice hand-off. Sequence alongside the
[`tool-approval-state-consolidation.md`](./tool-approval-state-consolidation.md)
Phase 3 — they share the `dispatchLock` and the single-writer rule.
