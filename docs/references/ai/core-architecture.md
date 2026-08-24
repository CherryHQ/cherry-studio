---
description: End-to-end Chat and Agent Conversation command, effect, persistence, and resource flow
sources:
  - src/main/ai/conversation
  - src/main/ai/agentSession/AgentConnectionManager.ts
  - src/main/ipc/handlers/ai.ts
---

# AI core architecture

Chat and Agent share one owner model: one `ConversationActor` per conversation.
The actor owns its aggregate and uses the pure `transitionConversation()`
reducer. `ConversationRuntimeService` is the lifecycle/IPC facade. Existing Chat
and Agent message tables remain the durable history stores.

```text
Renderer / Channel / Schedule / Delivery
  → ConversationRef + typed input
  → per-Conversation actor admission FIFO
  → side-effect-free validation
  → pure aggregate transition preview
  → synchronous history commit
  → ConversationActor aggregate commit
  → typed execution / terminal-persistence / presentation effects
  → exact EffectId result command
```

## Owner boundaries

| Owner | Authority |
|---|---|
| ConversationActor | one Conversation's aggregate, admission FIFO/epoch, committed inputs, exact Stop/effect operations, retry barrier, and final quiescence confirmation |
| transitionConversation reducer | pure per-Conversation Inbox, logical Turn, executions, interactions, Stop, terminal, and domain-quiescence transition |
| ConversationRuntimeService | lifecycle/IPC facade, actor lookup/reclamation, HistoryPort boot recovery, port composition, and global fixed-point pause/drain |
| Chat/Agent history adapters | existing SQLite tree or ordered Agent rows |
| AiExecutionManager | provider stream, abort, replay buffer, listener fan-out, private run fence |
| AgentConnectionManager | connection resources plus Agent-driver redirect, segment, reconcile, and projection effect execution |
| AgentMessageInteractionCoordinator | durable SessionMessage approval card and exact runtime resolver binding |
| PromptStreamManager | non-Conversation translation and API-gateway prompt resources |
| Renderer overlay/attachment | live projection and observation only |
| ChannelDeliveryService | outbound delivery policy and epoch fences |

## Turn flow

1. The IPC route converts the wire `ConversationRef` to the relevant history
   adapter address and submits one input.
2. The actor validates without writes and previews the reducer transition with
   preallocated turn, execution, and effect identities.
3. The history adapter atomically commits the durable user/assistant skeleton;
   a failed transaction leaves the aggregate unchanged.
4. The actor commits its aggregate as `Running` with `Starting` executions.
   The open acknowledgement now succeeds immediately.
5. Execution resources build context and open the provider under one
   `AbortSignal`. Preparation failure becomes the exact execution's Error
   terminal and never rolls back committed history.
6. Execution resources publish chunks directly; only control facts enter the
   aggregate.
7. A terminal outcome is immutable. The history port persists it, and only the
   exact persistence result can publish execution/turn terminal state.
8. Aggregate state determines domain quiescence; the actor additionally waits
   for committed inputs and admission/effect/terminal operation registries to
   drain. The facade only aggregates those registries for global pause/drain.

## Chat and Agent differences

- Chat history is the real topic tree, supports sibling fan-out, and routes an
  active submit to `NextTurn` plus clean yield.
- Agent history is one ordered branch. A compatible interactive follow-up is a
  `NextStep` redirect; rejected or undelivered input becomes `NextTurn`.
- Chat tool approval checkpoints end one provider run and start another.
  Stateful Agent approval resumes the existing connection. Interaction resume
  mode is typed; the aggregate, not a resource manager, chooses the effect.
- Agent native steer and autonomous output prepare receive-only assistant
  segments without re-sending already-delivered input.

## Related references

- [Conversation Runtime](./conversation-runtime.md)
- [Execution resource managers](./stream-manager.md)
- [Agent Session Runtime](./agent-session-runtime.md)
- [IPC transport](./ipc-transport.md)
- [Execution overlay](./execution-overlay.md)
