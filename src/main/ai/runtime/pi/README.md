# Pi integration

`PiRuntimeConnection` is the desktop's existing native Pi connection. The extracted runtime package
is developed separately and is not yet used by that connection.

## AI SDK model binding

`createAiSdkModelBinding` constructs a native Pi `ModelRuntime` and model for Cherry's AI SDK
execution path. Pass its model runtime, model, settings and extension factories to the Pi session
builder. Put the returned factories before approval handlers. The binding disables Pi retries;
Cherry's AI SDK request layer owns retries.

Each Pi request is converted to AI SDK messages and tools without `execute`. The supplied model
call performs one `streamText` step; Pi alone executes tools and decides whether another step or
compaction is needed. Every request sets `maxOutputTokens` as Pi's built-in providers do: the
call's cap, or the model's `maxTokens` when Pi gives none (its agent never does), lowered to what
the context window leaves after the context estimate and a 4,096-token margin (at least 1). This callback can invoke ai-core's executor with model middleware and request
plugins. It must not install another agent loop or replace Pi's context with Cherry chat history.

`aiSdkProvider.ts` converts streaming text, reasoning, tool calls, errors and usage back to native
Pi events. `aiSdkMessages.ts` applies native replay rules before conversion. `aiSdkMetadata.ts`
keeps provider metadata in Pi signature fields. Use stable provider/model identities so native
history replay recognizes the same model after reopening a session.

The binding guards malformed and unfinished tool calls before approvals, isolating its tracking by
native session ID. Original provider errors and parts Pi cannot display use the model-call side
channel. Usage forwarded to Pi is for context/budget accounting; do not bill it a second time.

The `aiSdk*.test.ts` integration tests cover the bridge with real AI SDK streaming and a local HTTP
provider. They do not establish live-provider or desktop integration acceptance.
