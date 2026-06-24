# Agent Loop — Reviewer Cluster

## Scope

| Subpath | Files | Role |
|---|---|---|
| `src/main/ai/runtime/aiSdk/` | `Agent.ts` | The class, hooks composition, write() forwarding |
| `runtime/aiSdk/loop/` | `index.ts` (types), `internal.ts` (hook wrappers) | Loop primitives, hook wrappers |
| `runtime/aiSdk/observers/` | `usage.ts` | Internal `Agent.on(...)` registrations |
| Tests | `loop/__tests__/agentLoop.test.ts` | Single-pass stream + hook composition |

The params side (`runtime/aiSdk/params/`) is reviewed separately in
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

`new Agent(params)` constructs and calls `attachUsageObserver(this)` — the
only internal observer — which registers an `onStepFinish` that writes a
`message-metadata` UIMessageChunk carrying token usage onto the currently
active writer.

Two public methods, `stream(initialMessages)` and
`generate(messages)`, share `buildAiSdkAgent()` because the agent config
is identical — only the underlying AI SDK call differs. `stream()` is
**single-pass**: one AI SDK stream piped through, no mid-stream message
injection (see Steering below).

### Hooks model

`AgentLoopHooks` (in `loop/index.ts`) defines six keys:

```
onStart, prepareStep, onStepFinish, onToolExecutionStart, onToolExecutionEnd,
onFinish, onError
```

`composeHooks(parts: ReadonlyArray<Partial<AgentLoopHooks>>)`
(`params/composeHooks.ts`) folds them. Per-key semantics:

- `onStart` / `onStepFinish` / `onToolExecutionStart` / `onToolExecutionEnd`
  / `onFinish` — `chainVoid`: sequential `for`-loop await; a per-hook throw
  is `logger.warn`'d and swallowed, the chain continues. No parallel /
  `Promise.allSettled` path.
- `prepareStep` — `chainPrepareStep`: sequential; each handler receives the
  previous handler's mutated options, results shallow-merged (`messages`
  threaded forward).
- `onError` — `chainOnError`: sequential; any handler returning `'retry'`
  makes the result `'retry'`, otherwise `'abort'`.

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

### Steering (abort + restart)

There is no in-loop steering and no message queue. `Agent.stream` makes a
single AI SDK pass; a follow-up never folds into the running turn (that
mutated in-flight history and had no clean turn boundary). Steering is
handled one level up by `AiStreamManager`:

- **chat** — a resubmit to a live topic is enqueued via
  `AiStreamManager.enqueuePendingSteer(topicId, userMessageId)`; the running turn
  yields at its next step boundary (the `hasPendingSteer` stop condition) and
  `onExecutionDone` chains a fresh continuation turn carrying the queued message.
- **agent session** — the follow-up is enqueued on the session's
  `pendingTurns` and the turn is interrupted between tool calls.

See [`docs/references/ai/stream-manager.md`](../../../docs/references/ai/stream-manager.md#steering).

### Error / abort path

`runAgentLoop` is the IIFE body. Settles the writer exactly once
through the `.then` / `.catch` chain:

```
(async () => {
  await onStart
  await agent.stream()
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
- Aborted streams still settle cleanly — `signal.aborted` short-circuits
  the error log.

## Validation

- `loop/__tests__/agentLoop.test.ts` — single-pass stream, hook
  composition, abort.
- `params/__tests__/composeHooks.test.ts` (167 cases) — per-key
  composition semantics.

## Follow-ups (out of scope)

- `onError` `'retry'` action — implement and surface as a per-feature
  retry policy.
- `runToCompletion()` / `toTool()` for subagent / agent-as-tool
  composition (gated on a real consumer landing).
- See also [Cherry AI tools — open work items](../../../v2-refactor-temp/docs/) if a more granular tool-loop split is wanted.
