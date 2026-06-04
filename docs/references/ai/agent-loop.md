# Agent Loop

## What it is

`Agent` (`src/main/ai/runtime/aiSdk/Agent.ts`) wraps `@cherrystudio/ai-core`'s
`createAgent(...).stream()` (built on the AI SDK's `ToolLoopAgent`) with a
`composeHooks` pipeline that folds N
independent hook contributors (per-feature plugins, AiService analytics,
internal observers) into a single `AgentLoopHooks` object with deterministic
ordering, then bridges one streaming pass to a `ReadableStream<UIMessageChunk>`
with a stable id for the first emitted message.

The stream is **single-pass**: `Agent.stream` runs the AI SDK stream exactly
once and pipes it through. There is no mid-stream message injection — steering
a chat turn is handled upstream by abort-and-restart (see
[Stream Manager](./stream-manager.md#steering)).

`Agent` does not know about topics, IPC, persistence, or multi-model
fan-out. Those concerns live in the stream manager — see
[Stream Manager](./stream-manager.md).

## API

```ts
const agent = new Agent({
  providerId, providerSettings, modelId,
  plugins, tools, system, options,
  hookParts,          // RequestFeature contributions
  messageId           // stable id for the first emitted UIMessage
})

const stream: ReadableStream<UIMessageChunk> = agent.stream(initialMessages, signal)
// or (non-streaming; input is { prompt } | { messages })
const result = await agent.generate({ messages }, signal)

// internal observers can also register on the agent:
const dispose = agent.on('onStepFinish', step => { … })
```

`stream()` and `generate()` share the underlying agent — only the AI SDK
call differs. Future `runToCompletion()` / `toTool()` are placeholders;
they don't ship in this PR.

## Hooks model

```ts
interface AgentLoopHooks {
  onStart?: () => Promise<void> | void
  prepareStep?: PrepareStepFunction             // chained
  onStepFinish?: (step) => Promise<void> | void // void-fan-out
  onToolExecutionStart?: (event) => Promise<void> | void
  onToolExecutionEnd?: (event) => Promise<void> | void
  onFinish?: () => Promise<void> | void
  onError?: (ctx) => 'retry' | 'abort'
}
```

Hook contributions come from three sources, all folded by `composeHooks`:

1. **Internal observers** (`Agent.on(key, fn)`) — `attachUsageObserver`
   (injects `message-metadata` chunks carrying token usage).
2. **Feature contributions** (`hookParts` param) — each `RequestFeature`'s
   `contributeHooks(scope)` (see [Params Pipeline](./params-pipeline.md)).
3. **Caller hooks** — `AiService` adds the analytics hook only (token-usage
   accounting via `onStepFinish` / `onFinish`). It does *not* contribute a
   root-span/trace lifecycle hook — the OTel root span is owned by
   `AiStreamManager.runExecutionLoop`.

Composition rules per hook key:

| key | rule |
|---|---|
| `onStart`, `onFinish`, `onStepFinish`, `onToolExecutionStart/End` | `chainVoid` — sequential `for`-loop await; per-hook throws logged and swallowed, chain continues |
| `prepareStep` | chained — each invocation receives the previous return value |
| `onError` | every handler invoked sequentially; any `'retry'` makes the result `'retry'`; default `abort` |

All void hooks share the same `chainVoid` helper in `composeHooks.ts` —
there is no `Promise.allSettled` / parallel path.

Tool execution events (`onToolExecutionStart/End`) are emitted by a
wrapper around each tool's `execute`. No released AI SDK version brackets a
single tool's execution: v6 exposes call-level (`experimental_onToolCallStart`)
and input-level (`onInputStart` / `onInputDelta` / `onInputAvailable`) hooks, but
nothing around `execute` itself — so we wrap. A future SDK version may add
Agent-level execution hooks with the same shape, at which point the wrapper is
removed and hook signatures stay stable.

## Steering

There is no in-loop steering. `Agent.stream` makes a single AI SDK pass and
never folds a mid-flight follow-up into the running turn — doing so mutated
in-flight history and had no clean turn boundary. A new chat submission to a
live topic is handled one level up by the stream manager: the dispatcher
aborts the running turn, waits for it to persist as `paused`, and starts a
fresh one — see [Stream Manager → Steering](./stream-manager.md#steering).

Agent-session runtimes are different: they queue their own follow-ups on the
session's `pendingTurns` and interrupt between turns rather than restarting —
see [Agent Session Runtime](./agent-session-runtime.md#live-follow-up).

## Error and abort

- `signal.aborted` is honoured throughout; aborted streams settle with
  the accumulated chunks already broadcast.
- Thrown errors are caught and routed through `onError`. Returning
  `'retry'` is reserved for a future implementation — today the loop
  logs and aborts.
- The writer is settled exactly once via the `then`/`catch` of the
  internal IIFE — listeners never see a half-closed stream.

## Where to read more

- Code: `src/main/ai/runtime/aiSdk/`
- Tests: `src/main/ai/runtime/aiSdk/loop/__tests__/agentLoop.test.ts`
- Stream manager integration: [Stream Manager](./stream-manager.md)
- Hook contributors: [Params Pipeline](./params-pipeline.md)
