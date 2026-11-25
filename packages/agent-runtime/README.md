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

`RuntimeMessage` specializes AI SDK `UIMessage` with native completeness, optional placed-input metadata and
message-local model-response errors in `metadata.error`.
`ThreadSnapshot.messages` installs the thread baseline. `message.reconcile` installs or corrects one
native source, including metadata changes and explicit aliases in `replaces`. `message.remove` removes
one source by reference. Activity, input outcomes, and child relationships remain separate facts.

`message.parts` carries ordered edits at known native part positions. Text and reasoning use `open`,
`append`, and `finish`. A `correct` edit replaces the text and state of one known block when the native source revises it.
`put` carries a changed file or tool part, including replacement of preliminary
tool output. Adapters can publish proven individual text mutations and output-only updates through the
dedicated native part events. A new baseline includes the accepted text and tool updates.
Accepted JSON tool parts and their payloads are deeply frozen and shared across isolated delivery
containers. Text updates reuse settled payloads without copying or comparing their bodies.

`RuntimeMessageStream` uses the pinned `ai@6.0.185` reader once per streaming native message,
before observer fanout. Adapters receiving cumulative messages extract edits for the affected source.
The reader is not seeded from a partial snapshot: SDK parser state must come from native deltas.

`ProductInputState` carries the ID from the submitted draft. A raw `InputState` can also
describe autonomous work with only a native reference. A driver forwards a product input
change when its source identifies the product ID. Input lookup takes the original thread
and product ID. Pi and Claude can answer while their owner retains evidence. Pi Durable
also supports lookup against its stored submissions.

`ThreadFeed` is a protocol utility: one normalized snapshot, ordered per-observer delivery,
bounded pending frames, explicit overflow gaps, and observer error isolation. It owns no native
queue or execution lifecycle. Published values pass through `immutable()`: the publisher's containers
are copied once and frozen, while values already frozen by an earlier publication are reused. The
stored snapshot, `state`, `message(id)`, captured metadata and every observer delivery share those
frozen values; mutating one throws instead of affecting other consumers. Adapters that republish
unchanged messages from `snapshot` or their own `immutable()` cache therefore keep message identity,
so pending frames and downstream comparisons do not multiply history. `messageIds` and
`messageInputId(id)` read scalar identities. Adapters maintain source identity before publishing
events. `observeCaptured` captures concrete metadata with each native revision and retains critical
frames through overflow recovery. More than 100 pending frames replaces superseded ordinary delivery
with a gap and a current recovery snapshot while retaining critical frames; more than 1,000 retained
critical frames closes the observation with `source-lost`. History is never truncated to fit.
The first baseline remains first even when overflow closes an observation before its callback starts.
An unrecoverable control backlog closes the observation with a gap instead of inventing completion.
`Observation.drain()` joins delivery and callbacks through the facts already published when it is called.
Seal native production before the final drain and archive flush. `stop()` discards queued delivery; it is not
a write barrier. Detach and release only after the final flush, and keep backup pauses write-free until resume.

Pi projection facets use `observeProjection`. The feed owns event selection and the facet
supplies metadata for that revision. Text-only edits can be delivered as individual native operations.
Mixed edits stay in their original order in one `message.parts` event. The feed validates the addressed
positions together before notifying observers. A rejected batch leaves the source and its revision intact.
Explicit snapshot and reconciliation reads materialize the accepted source when needed.

Pi-specific APIs previously in this package live in `@cherrystudio/agent-runtime-pi`. Pi Durable
has a separate adapter in `@cherrystudio/agent-runtime-pi-durable`; both are wired into the desktop.
[`@cherrystudio/agent-runtime-claude-code`](../agent-runtime-claude-code/README.md) provides Claude's
package adapter and powers the Claude desktop connection. See the [runtime contract](../../.agents/notes/proposed/architecture/2026-10-17-agent-runtime-contract.md).
