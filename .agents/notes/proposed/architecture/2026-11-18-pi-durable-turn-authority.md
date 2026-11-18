# Agent Note: Pi Durable owns the desktop turn lifecycle

Status: proposed

English | [中文](2026-11-18-pi-durable-turn-authority.zh.md)

## Problem

Pi Durable records each input's lifecycle durably. That record covers admission, placement, the native input queue, the outcome (`completed`, `aborted`, `failed`, or `unanswered` with a reason), the user stop record, and recovery after reopening. The [runtime contract](2026-10-17-agent-runtime-contract.md) already treats the terminal outcome as native evidence that the host consumes, and the [Durable adapter](../../../../packages/agent-runtime-pi-durable/README.md) implements no second scheduler or queue.

The desktop host does not follow that division of responsibility. `pi-durable` connects through the same `AgentRuntimeConnection` and per-turn stream as Claude Code and non-durable Pi, whose execution ends with Main. For those runtimes, the in-memory state machine in [AgentSessionRuntimeService](../../../../src/main/ai/agentSession/AgentSessionRuntimeService.ts) is the only record of a turn. For `pi-durable`, the same machine sits above a durable authority and decides the following again, in volatile memory:

- **How a turn ended.** [PiDurableRuntimeConnection](../../../../src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.ts) reports every outcome other than `completed` as a failure unless its local `closing` flag is already set. `closeEntry` then ranks that error above an already persisted status.
- **Whether an input may start.** `send()` rejects input while a local `sending` flag is set, and the host keeps its own queue.
- **When execution stops.** Stop closes the connection, and the close shuts the backend down when this connection is its last user. Any observation error also closes the connection.
- **Which turn resumed work belongs to.** After a restart, a resumed input appears as an autonomous turn.

Evidence from one `pi-durable` session:

- All five assistant rows stored as `error` belong to inputs that Durable recorded as `unanswered` / `aborted`.
- Two of those rows have no parts, although Durable holds committed entries for them.

In a local measurement:

- Stop waited on hung image reads during shutdown.
- The child archive flush was rejected as closed.
- The close failed after 20 seconds.

The tracking issue is [#24748](https://github.com/CherryHQ/cherry-studio/issues/24748); the reported symptoms are [#24732](https://github.com/CherryHQ/cherry-studio/issues/24732) and [#24469](https://github.com/CherryHQ/cherry-studio/issues/24469).

## Proposal

### Authority split

| Fact | Owner for `pi-durable` | Host role |
| --- | --- | --- |
| Input admission, placement, and queue | Durable submissions | Submit with a native busy policy; mirror placement for display |
| Turn outcome | Durable input outcome | Map it once to a product status |
| Stop | Durable user stop record | Request it; never close the connection to achieve it |
| Execution lifetime | Durable backend owner | Release only on explicit retirement or app exit |
| Reply content | Durable committed entries | Project them into product rows that can be rebuilt |
| Stream delivery to the renderer | Host memory | Hold controllers, buffers, and connection handles |

For `pi-durable`, the in-memory state machine keeps ephemeral delivery state only. Claude Code and non-durable Pi keep the current machine as their authority; this note does not change them.

### Outcome

A single mapping in the connection turns Durable's input outcome into the product terminal status:

- `completed` → `success`
- `aborted` → `paused`
- `failed` → `error`, carrying the native error
- `unanswered` → `error`, carrying its reason; `output-truncated` keeps the output-limit classification

The mapping does not depend on whether the host is closing. Once a reply is persisted with a terminal status, no later host cleanup path writes another terminal status for it.

### Stop

Stop requests Durable's user stop and does nothing else to the execution. Durable writes the stop record before it aborts the foreground scope; the record survives a restart, and repeating the request is harmless. To keep the current product behavior, Stop also stops each running background child through the child stop operation. Leaving background children running is listed as an alternative.

The connection and the backend stay open, so the next message neither reopens the backend nor reloads history.

### Connection faults

An observation gap or a failed child observation resynchronizes the projection from a fresh native snapshot instead of closing the access. The access is released only in these cases:

- native closure;
- explicit retirement, such as session deletion, archiving, or an edit that needs a new native context;
- app exit.

Configuration rebuilds keep waiting for an idle connection, as they do today.

### Admission

A message sent while a turn runs is submitted to Durable with `steer` or `follow-up`, and Durable persists it immediately. The host removes the local `sending` gate and its own queue for `pi-durable`. The reply row of a queued input is bound when Durable places that input, through the input's answer association.

### Recovery

Product rows are projections of Durable's record. On reopen, the host reads Durable's submissions for the bound context:

- A resumed input is attached to its original user message through that message's native input ID, and its output continues in that message's reply.
- A reply that never reached terminal persistence gets its parts from Durable's committed entries and its status from the Durable outcome.

Boot recovery never marks a `pi-durable` reply as `error` without a Durable outcome.

### Delivery

Implementation follows the Spec-first stack:

1. Outcome mapping (AC1).
2. Stop without closing, and resynchronization on faults (AC2, AC3).
3. Recovery and rebuild (AC5, AC6).
4. Native admission (AC4).
5. Electron acceptance and the transition to implemented (AC7).

## Alternatives considered

- **Fix the flag timing.** Set `closing` before the interrupt and stop `closeEntry` from overriding a settled status. This fixes #24732 but keeps two authorities: every new flag can reproduce the same class of bug, and a restart still loses the turn.
- **Persist a host turn table for every runtime.** A per-turn record holding status, failure reason, and native references would also help Claude Code and Pi. For `pi-durable`, Durable's submissions already are that record, and a second copy would bring back dual writes. The table remains a candidate for the non-durable runtimes.
- **Keep closing on Stop, but flush before shutdown.** This removes the archive loss. It does not remove the hang on unfinished tasks or the history reload after every Stop.
- **Let Stop leave background children running.** This matches Durable's native abort scope and lets delegated work finish, but it changes what Stop does for users today. Each background task can still be stopped on its own. This note does not adopt it; it can be revisited as a product decision.

## Acceptance criteria

- AC1 — A `pi-durable` reply's persisted status always equals the mapping of Durable's input outcome (completed→success, aborted→paused, failed or unanswered→error with a reason); a stop that Durable reports before the connection closes stays `paused`, and no host cleanup path replaces a persisted terminal status. (verification: unit — real Durable runtime and SQLite connection test, host state-machine test)
- AC2 — Stop records Durable's user stop and ends the foreground turn and running background children, while the connection and backend stay open; the next message starts without reopening the backend. (verification: unit — real runtime connection test)
- AC3 — An observation gap or a failed child observation neither closes the Durable access nor ends the turn; the projection resynchronizes, and the turn's status still comes from Durable. (verification: unit — real runtime with injected observation faults)
- AC4 — A message sent during a running turn is accepted by Durable under its native busy policy and survives a crash; the "Durable already has an active submission" error cannot occur, and each queued input gets its own reply. (verification: unit — real runtime; Electron)
- AC5 — After an unclean exit, reopening attaches a resumed Durable input to its original user message, and its output continues in that message's reply instead of a new autonomous reply. (verification: unit — real runtime reopen test)
- AC6 — On reopen, a reply that never reached terminal persistence is rebuilt from Durable's committed entries with its Durable outcome, and boot recovery never sets `error` on a `pi-durable` reply that has no Durable outcome. (verification: unit — database and runtime)
- AC7 — In Electron, Stop and resend, steer, queued follow-up, and killing Main mid-turn on a real `pi-durable` session each show the Durable outcome and keep subagent content, with no synthesized unknown-error card. (verification: Electron)

## Risks

- **Residency.** Keeping the backend open after Stop keeps its memory resident. The backend is already retained while idle, so the change removes the reopen cost rather than adding residency.
- **Shared scheduler.** Native `submit` and `interrupt` can resume the whole Harness, including other conversations. Stop no longer pairs them with a shutdown, so hidden scheduler effects need tests on shared backends.
- **Row rewrites.** Rebuilding replies on reopen rewrites the status and parts of product rows that were stored wrongly before this change. The rewrite follows Durable's record, and rows without a Durable outcome stay unchanged.
- **Reply timing.** Moving admission to the native queue changes when reply rows appear for queued messages, so the renderer must tolerate a user message that waits for its reply row.
- **Host-side child stop.** Stopping background children is a product rule that the host implements. If Durable later offers a scoped stop, the host should switch to it.
