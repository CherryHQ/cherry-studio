# Agent runtime contracts

Harness-neutral contracts for accessing a thread, submitting native input, observing normalized
facts, interrupting foreground work, and releasing access/resources. This package has no Pi,
Electron or application dependency and does not schedule agent execution.

`Thread` is the stable native context identity within a backend. `ThreadHandle` is a live access
with submit, observation and release operations; releasing it does not delete the thread or abort
its work. The host stores product-session relationships separately from native context storage.

`ThreadFeed` is a protocol utility: one normalized snapshot, ordered per-observer delivery,
bounded pending frames, explicit overflow gaps, and observer error isolation. It owns no native
queue or execution lifecycle. Adapters maintain source identity before publishing events.

Content uses AI SDK `UIMessage`/parts through `RuntimeMessage`. `RuntimeMessageStream` accumulates
native chunks with `readUIMessageStream` once before observer fan-out. Snapshot/upsert delivery,
input facts, activity, and execution ownership remain separate from message content.

Pi-specific APIs previously in this package live in `@cherrystudio/agent-runtime-pi`. Pi Durable
has a separate adapter in `@cherrystudio/agent-runtime-pi-durable`. Neither adapter is wired into
the desktop app yet. See the [runtime contract](../../.agents/notes/proposed/architecture/2026-10-17-agent-runtime-contract.md).
