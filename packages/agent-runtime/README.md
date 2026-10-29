# Agent runtime contracts

Harness-neutral contracts for accessing a thread, submitting native input, observing normalized
facts, interrupting foreground work, and releasing access/resources. This package has no Pi,
Claude SDK, Electron, or application dependency and does not schedule agent execution.

`Thread` is the stable native context identity within a backend. `ThreadHandle` is a live access
with observation and release operations. Its optional `input` groups `submit` with supported
busy `policies`; observation-only access omits it. Releasing an access does not delete the thread
or abort its work. The host stores product-session relationships separately from native context storage.

`Subagent { id, parent, child? }` describes an observed relationship. Its ID is scoped to the
parent and survives child continuation; it is not an assignment ID or completion status. A child
without an accessible context omits `child`. Snapshots expose `subagents`, and `subagent.upsert`
updates one relationship. Open an available child separately to observe its output or use its input.

`InputState.response` links a logical input to its evidenced terminal response. Several inputs
may share that message; a response may be failed, aborted or truncated, so its presence alone is not
success. Missing outcome remains unknown. References follow the source's current-view identity
and coverage rules; the host retains native correlation separately when it needs restart recovery.

`RuntimeMessage` specializes AI SDK `UIMessage` with native completeness and optional placed-input metadata.
`ThreadSnapshot.messages`, `message.upsert`, and `message.remove` expose whole native messages.
Ordered parts retain text, reasoning, files, and tools; results and preliminary output update the
originating tool part. Activity, input outcomes, and child relationships remain separate facts.

`RuntimeMessageStream` uses the pinned `ai@6.0.185` reader once per streaming native message,
before observer fanout. Adapters with authoritative snapshots publish message values directly.
The reader is not seeded from a partial snapshot: SDK parser state must come from native deltas.

`ThreadFeed` is a protocol utility: one normalized snapshot, ordered per-observer delivery,
bounded pending frames, explicit overflow gaps, and observer error isolation. It owns no native
queue or execution lifecycle. Adapters maintain source identity before publishing events.

Pi-specific APIs previously in this package live in `@cherrystudio/agent-runtime-pi`. Pi Durable
has a separate adapter in `@cherrystudio/agent-runtime-pi-durable`; both are wired into the desktop.
[`@cherrystudio/agent-runtime-claude-code`](../agent-runtime-claude-code/README.md) provides Claude's
package adapter and powers the Claude desktop connection. See the [runtime contract](../../.agents/notes/proposed/architecture/2026-10-17-agent-runtime-contract.md).
