# Pi integration

`PiRuntimeConnection` is the desktop's existing native Pi connection. The extracted runtime package
is developed separately and is not yet used by that connection.

## AI SDK model binding

`createAiSdkModelBinding` constructs a native Pi `ModelRuntime` and model for Cherry's AI SDK
execution path. Pass its model runtime and model to the Pi session builder. Through the builder's
session requirements, every session on that runtime installs the binding's tool-call guard ahead
of its own extensions and runs with Pi's retry off, whatever settings the host gives.

Each Pi request is converted to AI SDK messages and tools without `execute`. The supplied model
call performs one `streamText` step; Pi alone executes tools and decides whether another step or
compaction is needed. This callback can invoke ai-core's executor with model middleware and request
plugins. It must not install another agent loop or replace Pi's context with Cherry chat history.

`aiSdkProvider.ts` converts streaming text, reasoning, tool calls, errors and usage back to native
Pi events. `aiSdkMessages.ts` applies Pi's replay rules (`transformMessages`) before conversion.
`aiSdkMetadata.ts` keeps provider metadata in Pi signature fields.

## Host-facing contracts

- **`ModelCallPort`** – the only way out to a model. The request carries a `requestId`, Pi's
  `sessionId`, the Pi `model` it is for, and `options`, the host's own per-request settings.
- **Reasoning** – the host decides it through `requestOptions` (forwarded verbatim on every
  request), never through Pi's thinking level, which lacks Cherry levels such as `ultra`.
- **Output tokens** – every request sets `maxOutputTokens` as Pi's built-in providers do: the
  call's cap, or the model's `maxTokens` when Pi gives none (its agent never does), lowered to what
  the context window leaves after the context estimate and a 4,096-token margin (at least 1).
- **Side channel** – `onError` receives the original error object (for example `APICallError`
  with `statusCode` and `responseBody`; not called on abort), and `onUnmappedPart` receives
  `source`, `file` and provider-executed tool parts. Both get the request identity. Pi keeps only
  the error message, as the provider wrote it, so Pi's context-overflow detection still works.
- **Invalid tool calls** – a call whose input is unparsable or not a JSON object, or whose input
  the stream never finalized (it ended after `tool-input-start`), is replayed with `{}`, and the
  tool never runs on it. When the tool's schema has required fields, Pi's argument validation
  rejects `{}`; otherwise the binding's guard, fed by `onInvalidToolCall` and installed ahead of
  every other extension's `tool_call` handler (an approval prompt never sees the call), answers
  with the AI SDK's error (for an unfinished call: that the stream ended before its input was
  complete). A call to an unknown tool gets Pi's `Tool <name> not found`. A host registering
  `createAiSdkProvider` itself must block the calls `onInvalidToolCall` reports the same way.
- **Usage** – the usage handed to Pi feeds its context accounting and compaction only. The host's
  AI SDK calls already account it, so it must not be billed again.
- **Retries** – Pi's retry is always off for sessions on the binding (a session requirement that
  overrides the host's settings). Retries belong to the AI SDK layer.
- **Model identity** – the binding takes a Cherry model and derives its native identity from
  Cherry's unique model id (`providerId::modelId`) alone: the Pi provider is the Cherry provider
  id, the Pi model id is the Cherry model id and the API is `ai-sdk`. Pi replays a stored reply's
  reasoning and signatures only to that same provider/api/model, so a session reopened through a
  new binding for the same Cherry model keeps them, whatever its name or limits now are. Pi 1.3.0
  drops another model's reasoning from replay instead of sending it as plain text; that model's
  text and tool calls are kept without their signatures.

## Known gaps

- Pi's `after_provider_response` extension event never fires for these models: `streamText` does
  not expose response headers before the body is consumed.
- Tool call ids from another provider are replayed as-is (no `normalizeToolCallId`). A provider
  with stricter id rules may reject history recorded by a different one.
- The CherryIN Anthropic endpoint omits the thinking block of tool-only replies but requires one on
  replay; Cherry's Pi runtime rebuilds it from the response id (`piThinkingReplay.ts`). The native
  session keeps each reply's `responseId`, but requests do not expose it to the port yet; how they
  will is decided when the host is wired up.

The `aiSdk*.test.ts` integration tests cover the bridge with real AI SDK streaming and a local HTTP
provider. They do not establish live-provider or desktop integration acceptance.
