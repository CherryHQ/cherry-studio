---
description: Provider execution and prompt-stream resource managers beneath ConversationRuntimeService
sources:
  - src/main/ai/conversation/AiExecutionManager.ts
  - src/main/ai/conversation/PromptStreamManager.ts
  - src/main/ai/conversation/ConversationRuntimeService.ts
---

# Execution resource managers

Conversation lifecycle policy no longer lives in a stream manager. See
[Conversation Runtime](./conversation-runtime.md) for admission, Stop,
interaction, persistence, and quiescence semantics.

## AiExecutionManager

`AiExecutionManager` owns provider resources for one exact
`ConversationRef + TurnId + ExecutionId`:

- `AbortController` and private run fence;
- provider stream consumption;
- chunk sequence, replay buffer, listeners, and deferred tool outputs;
- accumulated message and runtime timing;
- driver redirect/resume callbacks.

It reports only first-chunk, interaction, terminal, and start-failure facts to
`ConversationRuntime`. It does not admit turns, select terminal durability, or
decide quiescence.

After the HistoryPort commits a skeleton, `ConversationRuntimeService` registers
an exact execution descriptor. The aggregate's `StartExecution` effect
synchronously creates the resource and its AbortController before
`ai.stream.open` acknowledges. Context build, compaction, driver binding, and
provider open then run under that same signal.

## PromptStreamManager

One-shot translation and API-gateway requests are not conversations.
`PromptStreamManager` owns those independent prompt resources, persists their
optional terminal projection, and releases them immediately. They do not create
a Conversation aggregate or synthetic Topic lifecycle.

## Persistence order

For Conversation executions, terminal delivery is:

```text
driver outcome
→ Conversation Persisting commit
→ history port write
→ exact effect result
→ execution terminal publication
→ turn terminal / quiescence publication
```

`ConversationTerminalPersistenceCoordinator` is the single retry owner. A
normal failure stays `Persisting`; explicit Stop may publish deferred recovery
only after its exact final retry fails.

## Attach and detach

Attach/detach are resource-plane operations. They add or remove observers and
replay buffered chunks without changing Conversation admission or lifecycle.
