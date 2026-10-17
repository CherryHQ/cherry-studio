# Pi integration

`PiRuntimeConnection` is the desktop's existing native Pi connection. The extracted runtime package
is developed separately and is not yet used by that connection.

## AI SDK model binding

`createAiSdkModelBinding` constructs a native Pi `ModelRuntime` and model for Cherry's AI SDK
execution path. Pass its model runtime and model to the Pi session builder. Through the builder's
session requirements, every session on that runtime, subagents' included, installs the binding's
tool-call guard ahead of its own extensions and runs with Pi's retry off, whatever settings the
host gives: Cherry's AI SDK request layer owns retries.

Each Pi request is converted to AI SDK messages and tools without `execute`. The supplied model
call performs one `streamText` step; Pi alone executes tools and decides whether another step or
compaction is needed. Every request sets `maxOutputTokens` as Pi's built-in providers do: the
call's cap, or the model's `maxTokens` when Pi gives none (its agent never does), lowered to what
the context window leaves after the context estimate and a 4,096-token margin (at least 1). This callback can invoke ai-core's executor with model middleware and request
plugins. It must not install another agent loop or replace Pi's context with Cherry chat history.

`aiSdkProvider.ts` converts streaming text, reasoning, tool calls, errors and usage back to native
Pi events. `aiSdkMessages.ts` applies native replay rules before conversion. `aiSdkMetadata.ts`
keeps provider metadata in Pi signature fields.

The binding takes a Cherry model and derives its native identity from Cherry's unique model id
(`providerId::modelId`) alone: the Pi provider is the Cherry provider id, the Pi model id is the
Cherry model id and the API is `ai-sdk`. Pi replays a stored reply's reasoning and signatures only
to that same provider/api/model, so a session reopened through a new binding for the same Cherry
model keeps them, whatever its name or limits now are. Subagent model keys (`provider/id`, kept in
a subagent's origin for continuations) follow the same rule.

The binding guards malformed and unfinished tool calls before approvals, isolating its tracking by
native session ID. Original provider errors and parts Pi cannot display use the model-call side
channel. Usage forwarded to Pi is for context/budget accounting; do not bill it a second time.

The `aiSdk*.test.ts` integration tests cover the bridge with real AI SDK streaming and a local HTTP
provider. They do not establish live-provider or desktop integration acceptance.
