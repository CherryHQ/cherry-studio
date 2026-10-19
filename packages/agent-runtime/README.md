# Agent runtime contracts

Harness-neutral contracts for accessing a thread, submitting native input, observing normalized
facts, interrupting foreground work, and releasing access/resources. This package has no Pi,
Electron, AI SDK, or application dependency and does not schedule agent execution.

`Thread` is the stable native context identity within a backend. `ThreadHandle` is a live access
with observation and release operations. Its optional `input` groups `submit` with supported
busy `policies`; observation-only access omits it. Releasing an access does not delete the thread
or abort its work. The host stores product-session relationships separately from native context storage.

`Subagent { id, parent, child? }` describes an observed relationship. Its ID is scoped to the
parent and survives child continuation; it is not an assignment ID or completion status. A child
without an accessible context omits `child`. Snapshots expose `subagents`, and `subagent.upsert`
updates one relationship. Open an available child separately to observe its output or use its input.

`ThreadFeed` is a protocol utility: one normalized snapshot, ordered per-observer delivery,
bounded pending frames, explicit overflow gaps, and observer error isolation. It owns no native
queue or execution lifecycle. Adapters maintain source identity before publishing events.

Pi-specific APIs previously in this package live in `@cherrystudio/agent-runtime-pi`. Pi Durable
has a separate adapter in `@cherrystudio/agent-runtime-pi-durable`. Neither adapter is wired into
the desktop app yet. See the [runtime contract](../../.agents/notes/proposed/architecture/2026-10-17-agent-runtime-contract.md).
