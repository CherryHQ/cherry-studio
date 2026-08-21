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

Backup pause closes idle warm connections and prevents new prewarm starts.
Connection starts, closes, and detached background-flow finalizers use exact
operation IDs in the Agent fixed-point drain. Active foreground resources are
pre-barrier work: Conversation drains their execution and terminal descendants,
then Agent closes the newly idle connection.

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

## Autonomous preemption

Autonomous runtime output is a Conversation scheduling decision, not a
connection-manager resume flag:

```text
Foreground
  → Preempting (exact SuspendExecution effect)
  → synchronously commit RuntimeInitiated assistant skeleton
  → RuntimePreempted
  → runtime terminal durable + ownership Released
  → exact ResumeSuspendedExecution effect
  → Foreground
```

Only one preemption layer is supported. A stale suspension result, skeleton
commit failure, or runtime bind failure restores the foreground execution and
discards the matching private buffer. `AgentConnectionManager` may buffer early
chunks and terminal facts for the exact resource, but only the Conversation
state machine decides resume, Stop, or inbox order.

## System prompt ownership

Cherry's runtime-neutral policy is materialized by
`buildAgentRuntimePrompt()`. It owns instruction precedence, built-in Agent
fallback and provisioning, prompt variables, channel security, citation and
artifact guidance, and response language. A driver maps the resulting
`{ base, append }` value into its SDK's native prompt representation; it may add
native workspace/context mechanics but must not fork Cherry policy.

## Pi driver resource boundary

Runtime discovery follows trust class, not a blanket workspace switch. Pi may
load text context such as `AGENTS.md` from the workspace explicitly selected by
the user. It must not auto-load workspace executable resources, user-global
extensions, skills, prompt files, or third-party tools without an explicit
Cherry trust flow. Automatic writes remain confined to canonical selected roots;
shell, external paths, symlink escapes, and approval-required mutations remain
gated.

## Related references

- [Conversation Runtime](./conversation-runtime.md)
- [Core Architecture](./core-architecture.md)
- [Adding an Agent Runtime](./adding-a-runtime.md)
