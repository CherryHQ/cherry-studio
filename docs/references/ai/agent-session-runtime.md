---
description: Agent connection resource ownership beneath the unified Conversation runtime
sources:
  - src/main/ai/agentSession/AgentConnectionManager.ts
  - src/main/ai/agentSession/agentConnectionResourceState.ts
  - src/main/ai/runtime/types.ts
---

# Agent connection runtime

Agent business lifecycle belongs to `ConversationRuntimeService`.
`AgentConnectionManager` is the resource executor for the stateful driver beneath
it; it does not own a second admission queue or Topic lease protocol. It also
executes Agent-specific history and projection effects because those are coupled
to driver events, but their results return to the Conversation actor.

## Responsibilities

`AgentConnectionManager` owns:

- one warm runtime connection per Agent Session;
- connection validation, reconcile, rebuild, and idle teardown;
- driver event consumption;
- native redirect execution;
- runtime usage, resume token, context usage, command catalog, retry, compaction,
  and background projections;
- receive-only resource preparation for native steer segments and autonomous
  output.

The Conversation aggregate owns:

- whether a fresh/queued/redirected input is admitted;
- `NextStep` versus `NextTurn` placement;
- the logical Turn and execution lifecycle;
- interaction resolution mode;
- Stop, terminal persistence, and quiescence.

## Driver event mapping

| Driver event | Conversation/resource handling |
|---|---|
| chunk | execution data plane |
| tool approval | typed interaction; in-place Agent resume |
| steer boundary | close current resource segment; prepare receive-only successor |
| steer undelivered | resubmit exact durable input as `NextTurn` |
| turn complete/error | execution terminal fact |
| autonomous started | RuntimeInitiated Conversation input |
| compaction/background state | typed activity plus cache/row projection |
| usage/resume/context/commands/retry | metadata projection only |

## Connection state

The internal connection reducer uses named string enums for events, generation
and connection state kinds, stream and delivery phases, occupancy, ownership,
and driver outcomes. It may
manage connection mechanics and chunk handoff, but it carries no Topic cycle,
attempt reservation, continuation lease, or row-ownership token.

## Persistence

Agent rows are written by the Agent history adapter over
`agent_session_message`. Normal and stopped terminals use the same
Conversation persistence coordinator as Chat. Background flow chunks patch the
assistant row that owns their root tool call and never fabricate a foreground
turn.

## Related references

- [Conversation Runtime](./conversation-runtime.md)
- [Core Architecture](./core-architecture.md)
- [Adding an Agent Runtime](./adding-a-runtime.md)
