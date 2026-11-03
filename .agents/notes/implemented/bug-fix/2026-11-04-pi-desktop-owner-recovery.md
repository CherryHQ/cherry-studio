# Agent Note: Pi desktop recovery stays with each state owner

Status: implemented

English | [中文](2026-11-04-pi-desktop-owner-recovery.zh.md)

## Problem

Local Pi commands could acknowledge state before creating a native file. Manual compaction had no behavior run to stop, and shutdown waited for its admission before cancellation. A failed child build retained a running record. Crash recovery excluded native-bound product placeholders, while the Responses gateway discarded reasoning identities and encrypted content needed for continuation.

## Decision

Pi's pinned SessionManager exposes an explicit first-file flush; local command acknowledgement follows it. Interrupt and shutdown cancel native compaction before joining admission. A child-open failure reaches the behavior lifecycle before report jobs start; the existing run-end decision records failure and frees capacity without rolling back successful siblings.

The desktop runtime selects Pi placeholders for restart terminalization. The message service applies that selection and preserves native bindings and resume tokens; delivery-owned turns remain with delivery recovery. Responses converters retain native reasoning IDs and ciphertext through AI SDK metadata, including empty summaries.

## Alternatives considered

- A product submission journal or transcript reconstruction would duplicate native persistence; neither is needed.
- Deleting native bindings to unblock product history would discard valid continuation identity.
- Rolling back all children after one build fails would undo successfully admitted sibling work.
- A direct provider bypass would split credential and billing ownership; the gateway's existing converters own the protocol repair.

## Consequences

Local state survives reopening without a model call. Restart settles abandoned product presentation without retrying input or claiming to recover external side effects. The small pinned Pi API addition requires compatibility coverage on upgrades. Live-provider and Electron acceptance remain separate from these offline regressions.

## Verification

- Regression — `PiRuntimeConnection.test.ts`: first `/goal` and plan-held goals persist before acknowledgement and reopen through real SQLite bindings.
- Regression — `behaviorRuntime.test.ts`: Stop and shutdown abort standalone manual summaries and finish closing.
- Regression — `behaviorAdapter.test.ts`: failed child construction frees capacity and preserves healthy siblings.
- Regression — `AgentSessionSubmission.test.ts`: selected native placeholders become terminal, editing unblocks, and native identity remains intact.
- Regression — `gatewayIntegration.test.ts` and the Responses converter tests: encrypted-only reasoning survives the production gateway and the next native Pi request, with one billing owner.
