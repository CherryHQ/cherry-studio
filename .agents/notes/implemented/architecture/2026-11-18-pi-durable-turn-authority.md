# Agent Note: Pi Durable owns the desktop turn lifecycle

Status: implemented

English | [中文](2026-11-18-pi-durable-turn-authority.zh.md)

## Problem

Pi Durable records each input's lifecycle durably. That record covers admission, placement, the native input queue, the outcome (`completed`, `aborted`, `failed`, or `unanswered` with a reason), the user stop record, and recovery after reopening. The [runtime contract](../../proposed/architecture/2026-10-17-agent-runtime-contract.md) already treats the terminal outcome as native evidence that the host consumes, and the [Durable adapter](../../../../packages/agent-runtime-pi-durable/README.md) implements no second scheduler or queue.

The desktop host did not follow that division of responsibility. `pi-durable` connects through the same `AgentRuntimeConnection` and per-turn stream as Claude Code and non-durable Pi, whose execution ends with Main. For those runtimes, the in-memory state machine in [AgentSessionRuntimeService](../../../../src/main/ai/agentSession/AgentSessionRuntimeService.ts) is the only record of a turn. For `pi-durable`, the same machine sat above a durable authority and decided the following again, in volatile memory:

- **How a turn ended.** [PiDurableRuntimeConnection](../../../../src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.ts) reported every outcome other than `completed` as a failure unless its local `closing` flag was already set. `closeEntry` then ranked that error above an already persisted status.
- **Whether an input may start.** `send()` rejected input while a local `sending` flag was set, and the host kept its own queue.
- **When execution stops.** Stop closed the connection, and the close shut the backend down when this connection was its last user. Any observation error also closed the connection.
- **Which turn resumed work belongs to.** After a restart, a resumed input appeared as an autonomous turn.

Evidence from one `pi-durable` session:

- All five assistant rows stored as `error` belonged to inputs that Durable recorded as `unanswered` / `aborted`.
- Two of those rows had no parts, although Durable held committed entries for them.

In a local measurement:

- Stop waited on hung image reads during shutdown.
- The child archive flush was rejected as closed.
- The close failed after 20 seconds.

The tracking issue is [#24748](https://github.com/CherryHQ/cherry-studio/issues/24748); the reported symptoms are [#24732](https://github.com/CherryHQ/cherry-studio/issues/24732) and [#24469](https://github.com/CherryHQ/cherry-studio/issues/24469).

## Decision

### Authority split

| Fact | Owner for `pi-durable` | Host role |
| --- | --- | --- |
| Input admission, placement, and queue | Durable submissions | Submit with a native busy policy; mirror placement for display |
| Turn outcome | Durable input outcome | Map it once to a product status |
| Stop | Durable user stop record | Request it; never close the connection to achieve it |
| Execution lifetime | Durable backend owner | Release only on native closure, explicit retirement, or app exit |
| Reply content | Durable committed entries | Project them into product rows that can be rebuilt |
| Stream delivery to the renderer | Host memory | Hold controllers, buffers, and connection handles |

For `pi-durable`, the in-memory state machine keeps ephemeral delivery state only. Claude Code and non-durable Pi keep the machine as their authority.

### Outcome

The connection maps Durable's input outcome to the product terminal status:

- `completed` → `success`
- `aborted` → `paused`
- `failed` → `error`, carrying the native error
- `unanswered` → `error`, carrying its reason; `output-truncated` keeps the output-limit classification

The mapping does not depend on whether the host is closing. Main applies the same mapping to replies that no live turn settles: a stopped reply and a reply rebuilt on reopen. Once a reply is persisted with a terminal status, no later host cleanup path writes another terminal status for it.

### Stop

Stop calls the connection's `interrupt()`. Durable writes its stop record before it aborts the foreground scope, and running background children are stopped through the child stop operation. Stop also withdraws queued follow-ups, which end `aborted`. The connection and the backend stay open; input sent after Stop waits for `stop-confirmed` and then reuses the same access. An unconfirmed stop falls back to closing after 20 seconds.

If Durable completed or failed the input before the stop landed, Main replaces the paused reply with that outcome. Main takes it from the outcome event, or from Durable's input record when the event arrived before Stop registered.

### Connection faults

Durable follows an observation gap with a recovery snapshot, and the connection keeps applying it. A failed child projection write reattaches that child from a fresh native snapshot. The backend error hook carries diagnostics only: it is logged and neither ends a turn nor closes a root. Configuration rebuilds still wait for an idle connection.

### Admission

A message sent while a turn runs is submitted to Durable and persisted at once:

- Enter while busy sends a native follow-up (`whenBusy: 'follow-up'`). The `nativeFollowUp` runtime capability makes the composer send at once instead of using its follow-up dock.
- The steer shortcut sends a steer (`whenBusy: 'steer'`) that Durable places before the next model call.

The connection admits these sends while native work runs; it refuses input only during compaction. Main opens a queued input's reply when Durable places the input, so each queued input gets its own reply. Main's own queue only holds input that Durable refuses or that arrives when no native work is running.

### Recovery

Product rows are projections of Durable's record. On reopen:

- A resumed input is attached to its original user message through that message's native input ID, and its output continues in that message's reply.
- A reply that never reached terminal persistence gets its parts from Durable's committed entries and its status from the Durable outcome.

Boot recovery never marks a `pi-durable` reply as `error` without a Durable outcome; it leaves an admitted delivery turn pending for the runtime to resume.

### Delivery

The decision shipped as a Spec-first stack:

1. Outcome mapping (AC1): [#24760](https://github.com/CherryHQ/cherry-studio/pull/24760).
2. Stop without closing, and resynchronization after child faults (AC2, AC3): [#24766](https://github.com/CherryHQ/cherry-studio/pull/24766).
3. Recovery and rebuild (AC5, AC6): [#24774](https://github.com/CherryHQ/cherry-studio/pull/24774).
4. Native admission (AC4): [#24777](https://github.com/CherryHQ/cherry-studio/pull/24777).
5. The remaining AC1 and AC3 paths, Electron acceptance, and this transition (AC7).

## Alternatives considered

- **Fix the flag timing.** Set `closing` before the interrupt and stop `closeEntry` from overriding a settled status. This fixes #24732 but keeps two authorities: every new flag can reproduce the same class of bug, and a restart still loses the turn.
- **Persist a host turn table for every runtime.** A per-turn record holding status, failure reason, and native references would also help Claude Code and Pi. For `pi-durable`, Durable's submissions already are that record, and a second copy would bring back dual writes. The table remains a candidate for the non-durable runtimes.
- **Keep closing on Stop, but flush before shutdown.** This removes the archive loss. It does not remove the hang on unfinished tasks or the history reload after every Stop.
- **Let Stop leave background children running.** This matches Durable's native abort scope and lets delegated work finish, but it changes what Stop does for users. Each background task can still be stopped on its own. It can be revisited as a product decision.

## Consequences

- A `pi-durable` message sent during a turn is saved before it runs, survives a crash, and gets its own reply. The follow-up dock is not used for `pi-durable`; Claude Code and Pi keep it.
- Stop keeps the backend and its history loaded, so the next message does not reopen the backend. The backend stays resident after Stop, as it already did while idle.
- Reopening rewrites the status and parts of rows that were stored wrongly before this change, following Durable's record. Rows without a Durable outcome stay unchanged.
- Native `submit` and `interrupt` can resume the whole shared Harness, and Stop no longer pairs them with a shutdown.
- Stopping background children remains a host rule. If Durable offers a scoped stop, the host should switch to it.
- An exception while applying a root observation batch still fails the turn and closes the access; it has no resynchronization path.
- With a model request or an approval still pending, the Electron app had not exited 30 seconds after quit, both before and after this change. This decision does not address app exit.
- No automated test covers an abort that Cherry did not start, and live providers are unverified; the Electron acceptance uses a local mock provider.

## Verification

- AC1 — `PiDurableRuntimeConnection.test.ts` › "reports a stop that Durable records before close as a paused turn, not a failure", "preserves output truncation through the desktop error boundary" and "keeps the turn and the access when the Durable backend reports a diagnostic"; `AgentSessionRuntimeService.projection.test.ts` › "keeps a stopped reply paused when the runtime reports the abort before closing", "replaces a paused reply with the Durable outcome reported before/after Stop registers" and "settles an unfinished reply from its Durable $outcome outcome on reopen".
- AC2 — `PiDurableRuntimeConnection.test.ts` › "keeps the access open after Stop, ends running background children and answers the next message"; `AgentSessionRuntimeService.projection.test.ts` › "keeps a retained connection open on Stop and starts later input only after native confirmation"; the Electron Stop scenario answers the next message.
- AC3 — `PiDurableRuntimeConnection.test.ts` with the real runtime: "resynchronizes a failed child projection without closing the root access" injects a child write fault, "resynchronizes the root projection after an observation overflow without ending the turn" produces Durable's overflow gap with a held consumer, and "keeps the turn and the access when the Durable backend reports a diagnostic" fires the backend error hook mid-turn.
- AC4 — `PiDurableRuntimeConnection.test.ts` native follow-up tests (placement after the preceding answer, a send during running work, Stop withdrawal, answering after reopen); `agentSessionRuntimeState.test.ts` placement transitions; `AgentSessionRuntimeService.projection.test.ts` › "gives a Durable input $label its own reply when placed"; `AgentComposer.test.tsx` busy Enter; the Electron queued follow-up and kill scenarios.
- AC5 — `PiDurableRuntimeConnection.test.ts` › "names the placed input that reopening resumes"; `AgentSessionRuntimeService.projection.test.ts` › "continues a resumed Durable input in its original reply"; in the Electron kill scenario the killed input completes in its original reply.
- AC6 — `AgentSessionRuntimeService.projection.test.ts` › "settles an unfinished reply from its Durable $outcome outcome on reopen"; `recoverSessionDeliveries.test.ts` › "leaves an admitted Durable delivery turn for the runtime to resume"; the Electron kill scenario ends without error rows.
- AC7 — `tests/e2e/smoke/piDurableTurnAuthority.test.ts` with a local mock provider: a queued follow-up, a steer, Stop followed by a new message, and SIGKILL of Main mid-turn each persist Durable's outcome with no error row or error part, and the Stop and kill scenarios show the subagent transcript in its panel. On the stack base the queued, Stop and kill scenarios fail.
