# Tool-Approval State Consolidation (design + refactor plan)

Status: **proposed** — diagnosis, target design, and a phased refactor plan; only
Phase 1 (CR-002) has landed. Surfaced while reviewing the steer-queue PR (vaayne
CR-001/CR-002). This is a cross-cutting refactor centred on `src/main`; it is
**not** part of any single split PR.

## Problem

A tool's approval state ("is this tool awaiting approval, and what was the
decision") is represented in **four places** with different lifetimes and update
channels, and the same decision is **applied in multiple places**. Because the
main-process stream, SQLite, and the renderer are three independent state holders
connected by async channels (broadcast / IPC / SWR) with **no transaction
spanning all three**, they cannot be made simultaneously consistent — and worse,
several of them are treated as *authorities*, so they can actively contradict
each other. The current code patches each contradiction window individually
(the `overlay-only` branch, CR-001, CR-002), which is the classic split-brain
"fix one window, open another".

### The four representations

| # | Representation | Lifetime | Updated by |
|---|---|---|---|
| A | in-memory stream `exec.awaitingApproval` | stream + 30 s grace | `AiStreamManager.onChunk` (`tool-approval-request` → true; `tool-output-*` → false) |
| B | status cache `topic.stream.statuses.<topicId>.awaitingApprovalAnchors` | broadcast at **terminal**, **lingers after grace eviction, lost on restart** | `ChatStreamLifecycle.onTerminal` |
| C | **DB** `message.data.parts[].state` (`approval-requested`/`approval-responded` + decision) | **durable — the only one that survives grace/restart** | terminal persistence + `Ai_ToolApproval_Respond` write + `prepareContinueDispatch` re-write |
| D | renderer card | render window | approval **state** derives from **C** — the `ToolUIPart` `approval-requested` state in the message parts (`useToolApproval`, `ToolBlockGroup` "sole source of truth"); **B** is read only by `useIsActiveTurnTarget` as the *active-turn* indicator + composer-override binding, **not** as the approval-state authority |

So the renderer side is already largely consolidated on **C**. The remaining
split-brain is on the **write side in main**: the same decision is applied in
**four** spots — the IPC `approvalDecisions` payload, the `Ai_ToolApproval_Respond`
DB write, the `prepareContinueDispatch` DB re-write
(`PersistentChatContextProvider.ts:308-330`), and the rebuilt model history
(`buildHistory`) — plus the **overlay-only** window where C lags the live part.

### Concrete inconsistency windows

1. **overlay-only** — the `tool-approval-request` chunk reaches the renderer (D
   shows a part) *before* terminal persistence lands, so **C has no part yet**.
   Approving here finds `targetPresent === false`, skips the DB write, and the
   decision survives only in the continue payload. (The `Ai_ToolApproval_Respond`
   handler's `overlay-only` comment is the band-aid for exactly this.)
2. **B vs C lifetime mismatch** — B (the active-turn indicator) is broadcast only
   at terminal, is **not cleared on grace eviction**, and **vanishes on restart**,
   while C stays `approval-requested`. So the active-target highlight (B) and the
   durable approval truth (C) diverge after eviction/restart: the card still
   renders from C, but the "this is the live turn" affordance + composer binding
   that key off B are stale/absent.
3. **approve → continuation gap** — C flips to `responded`, but B still says
   `awaiting-approval` until the continuation's new stream broadcasts `pending`.
   Briefly D sees B="awaiting" while C="responded".

### Why "simultaneously consistent" is unachievable

Three separate state holders + async channels = unavoidable propagation lag; no
single transaction spans `AiStreamManager` (memory) + SQLite + renderer (IPC).
The achievable goal is **one source of truth + eventual consistency via one
signal**, which removes the *contradictions* (two authorities disagreeing) — not
zero lag. The present design's defect is having **multiple authorities** (B and C
both treated as truth) plus the decision written in multiple places.

## Target design — single authority + stateless projection

- **Single source of truth = C (DB `message.data.parts`).** The approval
  lifecycle (`approval-requested → approval-responded` + decision) lives only in
  the DB, because it is the only representation that survives grace/restart.
- **A (`exec.awaitingApproval`) → transient projection.** Keep it only to derive
  the live `awaiting-approval` *status indicator* ("topic is waiting on a human"),
  not as an approval-identity authority.
- **Renderer card stays on C** — it already derives approval state from the
  message parts (`useToolApproval` / `ToolBlockGroup`). Keep B
  (`awaitingApprovalAnchors`) as the active-turn indicator only; the part flip
  already propagates through the message refresh the card consumes (no new
  anchor-based approval signal to add).
- **One atomic write + one signal + continuation reads the committed row.**
  Approve = one `withWriteTx` write (the CR-002 method) → emit a dedicated
  `Topic_*` invalidation → the continuation **reads the committed DB row** instead
  of carrying `approvalDecisions` and re-writing in `prepareContinueDispatch`.
  This collapses the IPC-payload + approve-write + continue-write triple into a
  single write + a read.

This is the "1 authority + stateless projection + 1 signal + pure selector" model
used by the streaming refactor.

## Relationship to the steer-queue review (#15935)

- **CR-002 (serialize the approval read-modify-write in `withWriteTx`)** is the
  first step toward this and is being landed now (`MessageService
  .applyToolApprovalDecisions`; pending check from the committed row).
- **CR-001 (continue-conversation racing a live stream)** is **not reachable** in
  the normal flow: the live turn that requested approval terminalizes to
  `awaiting-approval` (the MCP `needsApproval` step ends), and the active-target
  affordance keys off the terminal `awaitingApprovalAnchors` broadcast, so by the
  time the approve dispatches the stream is non-live → `send()` takes the start
  path, not the inject-drop path. Deferred (no `awaitTopicSettled` added); Phase 3
  removes the inject-drop seam entirely by having the continuation read committed C.
- The **`overlay-only` branch** and the **double-write in `prepareContinueDispatch`**
  are band-aids Phases 2–3 delete.

## Refactor plan

The renderer is already on C, so this is mostly a **main-side write-path collapse**:
make `Ai_ToolApproval_Respond` the single authoritative writer, then let the
continuation read committed C and delete the band-aids. Four small, independently
landable steps; each keeps the suite green.

### Phase 1 — atomic approval write ✅ done (CR-002)

- `MessageService.applyToolApprovalDecisions(anchorId, decisions)`: one
  `withWriteTx` reads → applies → writes the anchor parts and returns the
  **committed** parts. `Ai_ToolApproval_Respond` uses it and computes
  `anyStillPending` from the committed parts.
- **Files:** `MessageService.ts`, `AiService.ts`. **Done** — landed on
  `codex/main-3-ai-stream-steer-queue`.

### Phase 2 — persist the `approval-requested` part when it is emitted (close the overlay-only window)

- Today the `approval-requested` part reaches C only at **terminal** persistence,
  so a fast approve hits the **overlay-only** path (`applyToolApprovalDecisions`
  finds no part → no write → the decision rides the IPC payload). Persist the
  part as soon as the `tool-approval-request` chunk is captured (in the
  `PersistenceListener` projection / the chunk handler that already sets
  `exec.awaitingApproval`), so C carries it before the card is actionable.
- **Result:** every approve finds the part on the row → the Phase-1 write is
  always authoritative; the `overlay-only` branch becomes dead.
- **Files (main):** `AiStreamManager.onChunk` / the persistence projection,
  `PersistenceListener`. **Invariant:** an in-flight `approval-requested` part is
  persisted exactly once and is idempotent against the terminal projection.

### Phase 3 — continuation reads committed C; drop the payload + the second write

- `Ai_ToolApproval_Respond` no longer needs to carry `approvalDecisions` into the
  continuation: after the Phase-1 write, C already holds `approval-responded`.
  Remove `approvalDecisions` from `MainContinueConversationRequest`
  (`dispatch.ts`), and in `prepareContinueDispatch` **read** the committed anchor
  parts instead of `applyApprovalDecisions(...) + messageService.update(...)`
  (`PersistentChatContextProvider.ts:308-330`). `buildHistory` then reflects the
  committed state with no re-apply.
- **Result:** the decision is written **once** (Phase 1) and read everywhere else;
  the inject-drop seam CR-001 worried about is gone (no models to drop — the
  continuation just rebuilds from C).
- **Files (main):** `dispatch.ts`, `PersistentChatContextProvider.ts`,
  `AiService.ts` (drop the payload). **Then delete** the `overlay-only` branch in
  `Ai_ToolApproval_Respond`.

### Phase 4 — pin B's role + tidy the lifetime seam

- Assert (doc + a test) that `awaitingApprovalAnchors` (B) is **only** the
  active-turn indicator / composer binding — never an approval-state authority.
- Clear B on grace eviction (broadcast a terminal-cleared status, or have the
  renderer treat a missing live entry as "not the active target") so the stale-B
  window after eviction/restart closes. C remains the durable truth either way.
- **Files:** `ChatStreamLifecycle.ts`, `useIsActiveTurnTarget.ts` (renderer).

### Invariants (all phases)

- A decided tool **never reverts** to `approval-requested` (no lost update).
- **Exactly one** continuation resumes a multi-tool turn (the responder that
  commits the last decision).
- The decision **survives restart** (it is in C); B being gone after restart must
  not lose or duplicate it.
- The approved tool **executes once** (no double continuation / double-run).

### Validation

- Phase 1: `MessageService.test` (re-reads committed state per call + null/overlay
  cases) and `AiService.test` (handler uses the atomic method) — **done**.
- Phase 2: a test that an `approval-request` chunk persists the part to C before
  terminal, so `applyToolApprovalDecisions` finds it (no overlay-only path).
- Phase 3: a `prepareContinueDispatch` test that builds history from committed C
  with **no** `approvalDecisions` payload and **no** second write.
- Phase 4: a test that B absent (post-eviction/restart) leaves the card correct
  (from C) and the active-target affordance simply off.

## Scope

`src/main/ai/AiService.ts`, `AiStreamManager`/`ChatStreamLifecycle`,
`PersistentChatContextProvider`, the `topic.stream.statuses` cache contract, and a
light touch on the renderer active-target hook. The renderer **card** derivation
(`useToolApproval`) already reads C and needs no change. Do **not** fold this into
a narrow split PR — sequence Phases 2–4 as their own small PRs once the steer-queue
PR (Phase 1) lands.
