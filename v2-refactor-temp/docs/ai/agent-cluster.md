# Agent Loop — Reviewer Cluster

## Scope

| Subpath | Files | Role |
|---|---|---|
| `src/main/ai/agent/` | `Agent.ts` (303) | The class, hooks composition, write() forwarding |
| `agent/loop/` | `index.ts` (155 — types), `PendingMessageQueue.ts` (111), `internal.ts` (104) | Loop primitives, message queue, hook wrappers |
| `agent/observers/` | `steering.ts` (38), `usage.ts` (69) | Internal `Agent.on(...)` registrations |
| Tests | `loop/__tests__/agentLoop.test.ts` (337) | End-to-end queue drain + hook composition |

The params side (`agent/params/`) is reviewed separately in
[params-cluster.md](./params-cluster.md) so this cluster stays focused on
the loop semantics.

## Intent

v1's agent loop did not exist as a unit — `ConversationService` +
`ApiService` + `AiSdkToChunkAdapter` cooperated to advance a stream and
the call had no separation between the AI SDK call, the lifecycle hooks,
and the chunk fan-out. The v2 `Agent` class is the AI SDK agent + the
hook scheduling + the message queue, separately reviewable.

The architecture is described in
[`docs/references/ai/agent-loop.md`](../../../docs/references/ai/agent-loop.md);
this cluster doc lists what reviewers should look at and why.

## Key changes

### `Agent` class

`new Agent(params)` constructs and:

1. Calls `attachUsageObserver(this)` — registers an `onStepFinish` that
   writes a `message-metadata` UIMessageChunk carrying token usage onto
   the currently active writer.
2. Calls `attachSteeringObserver(this, pendingMessages)` — registers a
   `prepareStep` that drains the queue and appends to `messages`.
   Agent-session runtimes bypass this generic loop and consume their own
   long-lived pending queue.

Two public methods, `stream(initialMessages)` and
`generate(messages)`, share `buildAiSdkAgent()` because the agent config
is identical — only the underlying AI SDK call differs.

### Hooks model

`AgentLoopHooks` (in `loop/index.ts`) defines six keys:

```
onStart, prepareStep, onStepFinish, onToolExecutionStart, onToolExecutionEnd,
onFinish, onError
```

`composeHooks(parts: ReadonlyArray<Partial<AgentLoopHooks>>)`
(`params/composeHooks.ts`) folds them. Per-key semantics:

- `onStart` / `onFinish` — sequential await, errors logged, swallowed.
- `prepareStep` — chained (each invocation receives the previous return).
- `onStepFinish` / `onToolExecutionStart` / `onToolExecutionEnd` —
  parallel `Promise.allSettled`.
- `onError` — first non-`abort` wins; default `abort`.

Observer hooks (`agent.on(key, fn)`) compose into the same pass via
`Agent.composedHooks()`. Observers always run ahead of caller hookParts.

### `onToolExecution*` shim

AI SDK v6's `ToolLoopAgentSettings` doesn't expose tool-level callbacks
(`onStepFinish` fires per LLM step, not per tool, and lacks
`durationMs`). The agent loop wraps each tool's `execute` with a small
shim (`wrapToolsWithExecutionHooks` in `loop/internal.ts`) that:

- emits `onToolExecutionStart` with `{ callId, toolName, input, messages }`
- captures `durationMs` (excluding hook latency)
- emits `onToolExecutionEnd` with `{ ...startEvent, durationMs, toolOutput }`

The shape mirrors AI SDK v7's
`experimental_onToolExecutionStart/End`. When v7 lands the shim removes
and hook signatures stay stable. Cited in `loop/index.ts`:27.

### `PendingMessageQueue`

Session-isolated FIFO consumed by `attachSteeringObserver`. Drained:

1. **Mid-flight** — `prepareStep` hook drains and appends to the
   `messages` array AI SDK is about to send.
2. **Tail recheck** — after `agent.stream()` settles cleanly, the queue
   is checked once more. Non-empty triggers another `agent.stream()`
   call with the drained messages appended. Catches the race where the
   user injects after AI SDK's last `prepareStep` fires.

The queue is independent of `AiStreamManager.send` — the manager
pushes onto it for the inject path, but the queue's `enqueue` API is
generic.

### Error / abort path

`runAgentLoop` is the IIFE body. Settles the writer exactly once
through the `.then` / `.catch` chain:

```
(async () => {
  await onStart
  while (...) await agent.stream()
  await onFinish
})()
  .then(() => settleWriter())
  .catch(async (err) => {
    if (!signal.aborted) {
      const action = await invokeOnError(err)
      if (action !== 'retry') logger.error('agentLoop error', err)
      // TODO: retry logic
    }
    await settleWriter(err)
  })
```

The `'retry'` return is reserved — implementation is a known follow-up.

## Invariants

- Writer is settled exactly once (either successful close or `err`).
- Observers always compose ahead of caller hookParts; observers in
  registration order, hookParts in input order.
- `pendingMessages` is drained on both `prepareStep` and tail-recheck.
- Aborted streams still settle cleanly — `signal.aborted` short-circuits
  the error log.

## Validation

- `loop/__tests__/agentLoop.test.ts` (337 cases) — queue drain
  scenarios, hook composition, tail recheck, abort.
- `params/__tests__/composeHooks.test.ts` (167 cases) — per-key
  composition semantics.

## Follow-ups (out of scope)

- `onError` `'retry'` action — implement and surface as a per-feature
  retry policy.
- `runToCompletion()` / `toTool()` for subagent / agent-as-tool
  composition (gated on a real consumer landing).
- See also [Cherry AI tools — open work items](../../../v2-refactor-temp/docs/) if a more granular tool-loop split is wanted.
