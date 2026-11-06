# Agent runtime contracts

Harness-neutral contracts for accessing a thread, submitting native input, observing normalized
facts, interrupting foreground work, and releasing access/resources. This package has no Pi,
Claude SDK, Electron, or application dependency and does not schedule agent execution.

`Thread` is the stable native context identity within a backend. `ThreadHandle` is a live access
with observation and release operations. Its optional `input` exposes `submit`; observation-only
access omits it. Concrete adapters validate `whenBusy` before dispatch. Releasing an access does not delete the thread
or abort its work. The host stores product-session relationships separately from native context storage.

Every handle exposes passive `contextUsage()`. Confirmed readings distinguish full context
window, estimated or reported occupancy, and optional reserve/free
counts. Partial category breakdowns need not sum to the total; deferred resources do not occupy
current context. Reads never submit input or resume work. `context.changed` and snapshots carry
the same result, including unknown or unsupported capability. Revisions belong to their native
thread and must not be compared across backends. Context occupancy is not billable turn usage.

`Subagent { id, parent, child?, origin? }` describes an observed relationship. Its ID is scoped to the
parent and survives child continuation; it is not an assignment ID or completion status. A child
without an accessible context omits `child`. Snapshots expose `subagents`, and `subagent.upsert`
updates one relationship. Evidenced `origin` carries the parent-scoped creation `toolCallId` and optional
description; continuation does not replace that origin. Concrete facets provide `openChild(toolCallId, signal?)`
to await an admitted creation and return its relationship and access together, without starting execution.
Open an available child separately to observe its output or use its input.

`InputState` carries admission/placement facts, native input references and the terminal outcome.
Missing outcome remains unknown. The host retains native input bindings separately for restart
recovery; product reply identity and billing do not come from a common response pointer.
Interrupt, resume and shutdown return `OperationResult<void>`; success confirms the operation's
native contract, not application-wide cancellation.

`RuntimeMessage` specializes AI SDK `UIMessage` with native completeness and optional placed-input metadata.
`ThreadSnapshot.messages`, `message.upsert`, and `message.remove` expose whole native messages.
Ordered parts retain text, reasoning, files, and tools; results and preliminary output update the
originating tool part. Activity, input outcomes, and child relationships remain separate facts.

`RuntimeMessageStream` uses the pinned `ai@6.0.185` reader once per streaming native message,
before observer fanout. Adapters with authoritative snapshots publish message values directly.
The reader is not seeded from a partial snapshot: SDK parser state must come from native deltas.

`ThreadFeed` is a protocol utility: one normalized snapshot, ordered per-observer delivery,
bounded pending frames, explicit overflow gaps, and observer error isolation. It owns no native
queue or execution lifecycle. Adapters maintain source identity before publishing events. `observeCaptured`
captures concrete metadata with each native revision and retains critical frames through overflow recovery.
An unrecoverable control backlog closes the observation with a gap instead of inventing completion.
`Observation.drain()` joins delivery and callbacks through the facts already published when it is called.
Seal native production before the final drain and archive flush. `stop()` discards queued delivery; it is not
a write barrier. Detach and release only after the final flush, and keep backup pauses write-free until resume.

Pi-specific APIs previously in this package live in `@cherrystudio/agent-runtime-pi`. Pi Durable
has a separate adapter in `@cherrystudio/agent-runtime-pi-durable`; both are wired into the desktop.
[`@cherrystudio/agent-runtime-claude-code`](../agent-runtime-claude-code/README.md) provides Claude's
package adapter and powers the Claude desktop connection. See the [runtime contract](../../.agents/notes/proposed/architecture/2026-10-17-agent-runtime-contract.md).
