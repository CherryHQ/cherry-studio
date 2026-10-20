# Agent Note: Continued sub-agent flow identity across reconnects

Status: implemented

English | [中文](2026-10-18-subagent-resume-flow-identity.zh.md)

## Problem

A continued sub-agent's identity lived only in per-process, per-turn maps. Claude Code re-streams a resumed agent under its **original launch tool-use id** while the lifecycle edges describing the continuation carry the **resuming call id**; DSH (retired upstream while this work was in flight) bound a cold-resumed child to its own `send_message` call. Losing that mapping caused several distinct failures: continued content was dropped after a drain or a connection reset; a resume edge could displace the launch root; a fresh process had no mapping at all; delayed output could be buffered behind a row whose persisted marker had been evicted; and the UI showed a resumed child as completed because its status was read from a settled tool group whose parts context is deliberately emptied.

## Decision

The launch tool-use id is the single identity of a sub-agent run, and it survives every boundary.

**Main process.** Flow anchors survive drains and connection resets; a fresh connection recovers the launch root and the host row from the database, with retries spaced out so an outage cannot read per chunk. Task→tool-call registration is first-registration-wins, so a resume edge never displaces the launch root. A flow root's anchor follows the row its content streams into, so a round that starts in a live turn keeps its tail there after the adapter's mid-turn detach instead of splitting across the turn's row and the launch's row — the flow pane reads a round in message order, so a split round would read out of order. Detached chunks whose host row is unresolvable are buffered under bounded budgets; an overflow gives up the whole prefix, and the suppression is keyed to the parts the prefix left **open** — a part it also closed can never emit again, and a part retires once it restarts or ends, so nothing still streaming is ever forgotten while the record stays bounded, and a sibling stream's restart cannot admit an orphaned delta that aborts the SDK reader. Evicting a persisted-row marker also drops its anchors, so delayed output re-resolves the row instead of buffering until teardown. The current SDK prints its launch receipt as prose with parenthetical metadata between the prefix and the `agentId:` trailer; that native form is parsed through a shared grammar and pins the receipt's own call id exactly as the structured form does. A foreground launch answers with the child's own report and the SDK appends that same trailer after it — the id repeating in the send parenthetical and a usage block closing the output — so the trailing form is recognized too, and a later send can still continue the agent. A tool keeps the resume marker of the round it started in: the marker is frozen when its input starts, so a result that lands after a later send keeps its originating round instead of following the newer send. Blocks are attributed by the response they began in: the marker is frozen per observed response id — assistant frames carry one id per response, stream events track it from `message_start` — so a receipt landing mid-response cannot re-tag blocks the child had already started under it.

**Chat renderer.** A resume receipt presents as a launch-style entry: one shared resolver decides the flow target (adapter stamp → cross-message launch index → the child's retained runtime root, so a later send opens the root the runtime kept the task under); the row stays clickable when its historical launch is outside the loaded window but its own call is a proven root; and its task status is derived from the list-level launch index — where a settled task revives only on a new run's `started` edge — instead of the group's emptied parts. A nonterminal edge only overrides the row while the task is live — its origin turn still running, or still in the background membership — and the background capsule yields only to a loaded row that can navigate to the task's flow. A failed or cancelled send is not a resume entry: it keeps its diagnostic disclosure, with the failure's tooltip, instead of a flow entry — in the row and in the tool group's header alike. The live cache's edge is the current run's own belief: a nonterminal cache edge revives a settled task even after the `started` edge that justified the revival is gone, while an unvouched edge still cannot — the same liveness gates settle both.

**Flow pane.** The flow splits rounds by each continuation, ordered by the resume call that opened them rather than by walk position (a cold restart moves resumed content into the launch's row); each round keeps its prompt; the launch result text that duplicated the final report is dropped; a cold-resumed DSH child is its own root; a send counts as a continuation only once its delivery result is available — pending, failed, and cancelled sends are not; a delivered receipt opens its round by its runtime markers when they exist, keeping child output produced before the delivery in its originating round, and falls back to its walk position only where no marker evidence exists; and the status panel revives a settled run task on a new run's `started` edge, keeping a vouched run alive when the live cache advances past that start.

## Alternatives considered

- Keeping the identity in memory only — rejected: restart and session reopen lose it.
- Message-wide overflow suppression — rejected: one stream's restart admitted a sibling's orphaned delta.
- Evicting discarded part ids oldest-first — rejected: a part can still emit after its id is forgotten, and admitting that delta aborts the reader for every later chunk on the row.
- Duplicating the launch-receipt grammar in the main process — rejected: one shared grammar in `src/shared/ai/launchReceipt.ts`, used by the runtime adapter and the renderer.
- Pinning a resume edge's call id on a launch-root miss — rejected: it misroutes later navigation; only the launch receipt's own call id may fall back.
- Sorting flow messages after the fact — rejected: a round's content split across rows stays misattributed.

## Consequences

- The database is the recovery source for a fresh process; lookups are throttled.
- Bounded buffers may drop a stream's prefix; the stream rejoins only through a fresh start of the same part.
- DSH is retired upstream; the remaining DSH-specific handling serves historical transcripts.

## Verification

- Regression — `pnpm test:main src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts`: 220 passed, including overflow suppression past recovery, marker-eviction anchor invalidation, interleaved roots sharing one host message, a still-open part surviving a sibling's overflow of completed parts, the bounded look-up stamps, and a flow root staying anchored to the row its round streams into.
- Regression — `pnpm test:main src/main/ai/runtime/claudeCode/__tests__/streamAdapter.test.ts`: 88 passed, including the prose launch receipt, a foreground answer's trailing trailer registering the launch, another tool's receipt-shaped output not re-tagging the agent, a tool keeping the resume marker of the round it started in, and a response keeping the marker it began under.
- Regression — `pnpm test:shared src/shared/ai/__tests__/launchReceipt.test.ts`: 6 passed (receipt forms, spoof rejections, and the trailer a foreground answer carries).
- Regression — `pnpm test:renderer` pane and chat-renderer suites: 202 and 248 passed, including liveness reconciliation, capsule navigability, pre-root receipt rounds, the failed send keeping its diagnostic row and group header, the undelivered send staying out of round splitting, the pre-delivery round staying put after delivery, and a vouched live-cache edge reviving a settled run; `typecheck:node` / `typecheck:web` clean.
- Regression — every new test was verified to fail before its fix.
