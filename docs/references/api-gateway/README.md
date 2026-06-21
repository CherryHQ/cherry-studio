# API Gateway Reference

The **API Gateway** exposes Cherry Studio's AI capabilities over a local HTTP
server that speaks the **OpenAI** and **Anthropic** wire protocols, plus a few
Cherry-specific REST endpoints (models, knowledge bases). Any OpenAI- or
Anthropic-compatible client (SDKs, Claude Code, `curl`, …) can point at
`http://127.0.0.1:23333` and drive whatever provider/model the desktop app has
configured — Cherry becomes a universal translation gateway in front of every
provider it knows.

Internally each request is routed through main's `AiStreamManager` as an equal,
**non-persisting** subscriber (alongside the renderer's `WebContentsListener`
and the IM `ChannelAdapterListener`), and the resulting `UIMessageChunk` stream
is translated back into the caller's dialect by the adapter system.

> **Naming.** The code, IPC, preload, hook, and UI all use the
> **`apiGateway`** name. The persisted **preference / shared-cache** namespace
> is **`feature.api_gateway.*`** — same feature, two names. (`api_gateway` is the
> current namespace token; it replaced the retired `csaas` alias.) The legacy v1
> Redux layer (`apiServer.*`) is deprecated and reaches v2 only through the
> migrators; do not add fallbacks for it.

## Where the code lives

```
src/main/features/apiGateway/        ← the HTTP server (Elysia + @elysia/node)
├── server.ts                        ← `ApiGateway` class: listen / stop, http timeouts
├── app.ts                           ← `buildApp()`: CORS, OpenAPI docs, request-id, error handler, route mounting
├── errors.ts                        ← `gatewayErrorHandler` (path → anthropic/openai/rest envelopes),
│                                       `buildStreamErrorFrame` (streaming error/timeout frames), `transformOpenAiError`
├── ApiGatewayService.ts             ← lifecycle owner (start/stop, IPC, auto-start, running-state)
├── proxyStream.ts                   ← `processMessage()` — the core request → stream → response engine
├── reasoningCache.ts                ← google / openrouter reasoning-signature caches
├── middleware/
│   └── auth.ts                      ← `authorizeApiRequest` (x-api-key | Bearer, timing-safe)
├── routes/
│   ├── messages.ts                  ← POST /v1/messages, POST /v1/messages/count_tokens (Anthropic)
│   ├── chat.ts                      ← POST /v1/chat/completions (OpenAI Chat)
│   ├── responses.ts                 ← POST /v1/responses (OpenAI Responses)
│   ├── models.ts                    ← GET  /v1/models
│   ├── knowledge/                   ← GET/POST /v1/knowledge-bases[/search|/:id]
│   └── schemas.ts                   ← loose Zod body schemas (validate only what the gateway needs)
├── utils/
│   └── models.ts                    ← `getModels()` — the /v1/models data path (never throws)
└── adapters/
    ├── interfaces.ts                ← `IMessageConverter` / `IStreamAdapter` / `ISseFormatter` contracts
    ├── converters/                  ← input dialect → AI SDK `UIMessage[]` + tools + options
    ├── stream/                      ← `UIMessageChunk` → output dialect events (push API)
    ├── formatters/                  ← output event → SSE wire string
    └── factory/                     ← `MessageConverterFactory`, `StreamAdapterFactory`

src/preload/index.ts                      ← `window.api.apiGateway.{start,stop,restart}`
src/renderer/hooks/useApiGateway.ts       ← renderer state (config + running + loading) and actions
src/renderer/pages/settings/ToolSettings/ApiGatewaySettings/   ← settings UI
```

## HTTP surface

`buildApp()` (`app.ts`) assembles one Elysia app on the `@elysia/node` adapter.
CORS is open (`origin: true`); every request is stamped with an `X-Request-ID`
and its latency logged on completion.

### Public (no auth)

| Method & path | Purpose |
|---|---|
| `GET /` | API information (name, version, endpoint map) |
| `GET /health` | Health check (`{ status, timestamp, version }`) |
| `GET /openapi` | Scalar API docs UI (front-end assets load from a CDN — see note) |
| `GET /openapi/json` | OpenAPI JSON spec (fully local) |

> **Offline note.** `@elysia/openapi`'s Scalar provider serves an HTML page that
> pulls its UI bundle from a CDN, so `GET /openapi` (the human docs UI) needs
> network. `GET /openapi/json` — the machine-readable spec that programmatic
> clients/SDKs consume — is always served locally and is unaffected. To make the
> UI work fully offline, pass a self-hosted `cdn` URL to the `openapi({...})` config
> in `app.ts`.

### Protected (`/v1`, requires API key)

Mounted under a single `Elysia({ prefix: '/v1' })` that `.use(bearer())` and
applies a **`scoped`** auth guard — so the guard covers every `/v1` plugin but
none of the public routes above.

| Method & path | Dialect | In → out format |
|---|---|---|
| `POST /v1/messages` | Anthropic | `anthropic` → `anthropic` |
| `POST /v1/messages/count_tokens` | Anthropic | local token estimate (`tokenx`), no stream |
| `POST /v1/chat/completions` | OpenAI Chat | `openai` → `openai` |
| `POST /v1/responses` | OpenAI Responses | `openai-responses` → `openai-responses` |
| `GET /v1/models` | OpenAI list | `{ object:'list', data:[…] }`, ids are `providerId:modelId` (offset/limit) |
| `GET /v1/knowledge-bases` | Cherry REST | list (offset/limit) |
| `POST /v1/knowledge-bases/search` | Cherry REST | semantic search across bases |
| `GET /v1/knowledge-bases/:id` | Cherry REST | single base |

The model in every chat/messages/responses body is `"<providerId>:<modelId>"`
(split on the **first** `:`), e.g. `anthropic:claude-sonnet-4-6`.

## Request flow (chat / messages / responses)

All three streaming endpoints are thin route wrappers that call
`processMessage({ params, inputFormat, outputFormat, signal })` in
`proxyStream.ts`. That function is the heart of the gateway:

1. **Resolve model.** Read `params.model`, split on the first `:` into
   `providerId` / `modelId`, build a `uniqueModelId` via `createUniqueModelId`.
   `params.stream === true` selects streaming vs. JSON.
2. **Convert input.** `MessageConverterFactory.create(inputFormat, …)` returns
   the dialect's `IMessageConverter`, which yields:
   - `toUIMessages(params)` → AI SDK `UIMessage[]` (a system/instructions
     prompt becomes a leading `role: 'system'` message).
   - `toAiSdkTools(params)` → a `ToolSet` of **client tools** (no `execute`):
     the model emits the call and the gateway forwards it to the caller.
   - `extractStreamOptions(params)` → sampling (`temperature`, `topP`,
     `topK`, `maxOutputTokens`, `stopSequences`).
   - `extractProviderOptions(provider, params)` → reasoning/thinking options
     (the `Provider` is loaded best-effort from `ProviderService`).
3. **Assemble overrides.** Sampling + tools + provider options are merged into a
   single `CallOverrides` object — the gateway is **assistant-agnostic**, so
   everything is passed per-request (merged at highest precedence inside
   `buildAgentParams`).
4. **Pick the output adapter.** `StreamAdapterFactory.createAdapter(outputFormat)`
   + `.getFormatter(outputFormat)` give the `IStreamAdapter` (state machine that
   turns `UIMessageChunk`s into dialect events) and the `ISseFormatter` (event →
   SSE string).
5. **Drive the stream.** With `streamId = "gateway-<uuid>"`, call
   `AiStreamManager.streamPrompt({ streamId, uniqueModelId, messages, listener,
   callOverrides, idleTimeoutMs })`. This uses the **`promptStreamLifecycle`** —
   no status broadcast, no attach/reconnect, no persistence; the stream evicts
   immediately at terminal.
   - **Streaming**: an `SseListener` with a push-API `formatChunk` /
     `formatDone` / `formatPaused` / `formatError` pipes the adapter's events
     through the formatter into a `text/event-stream` `ReadableStream`.
   - **Non-streaming**: a plain `StreamListener` feeds every chunk into the
     adapter to accumulate state, then `adapter.buildNonStreamingResponse()` is
     returned as a JSON `Response`.
6. **Abort & timeout.** The route's `request.signal` (client disconnect) calls
   `aiStreamManager.abort(streamId, …)`. An idle (no-chunk) timeout —
   **20 minutes** (`GATEWAY_STREAM_IDLE_TIMEOUT_MS`) — and any mid-stream abort
   surface as a **failure**, not a truncated success: streaming emits a
   per-dialect error frame (`buildStreamErrorFrame`), non-streaming returns a
   **504**. The server's per-request timeout is **5 minutes** (`server.ts`), with
   `setTimeout(0)` so live SSE connections are not socket-timed-out.

```
client  ──HTTP──▶  route  ──▶  processMessage
                                  │  converter (in dialect → UIMessage[] + tools + overrides)
                                  ▼
                          AiStreamManager.streamPrompt  (equal, non-persisting subscriber)
                                  │  UIMessageChunk stream
                                  ▼
                          IStreamAdapter.transformChunk → ISseFormatter.formatEvent
                                  ▼
                          SSE ReadableStream  /  JSON Response   ──▶  client
```

## Adapter system

Two independent dialect axes, chosen by `inputFormat` / `outputFormat`:

| Role | Interface | Implementations |
|---|---|---|
| **Converter** (input → AI SDK) | `IMessageConverter` | `anthropic`, `openai`, `openai-responses` |
| **Stream adapter** (`UIMessageChunk` → events) | `IStreamAdapter` | `AiSdkToAnthropicSse`, `AiSdkToOpenAiSse`, `AiSdkToOpenAiResponsesSse` |
| **Formatter** (event → SSE string) | `ISseFormatter` | `AnthropicSseFormatter`, `OpenAiSseFormatter`, `OpenAiResponsesSseFormatter` |

The output formats are **`anthropic`**, **`openai`**, and **`openai-responses`**
— the full `OutputFormat` union, each registered in `StreamAdapterFactory`.

Adapters consume the AI SDK **`UIMessageChunk`** stream (not `fullStream`):

- **Usage** comes from `message-metadata` chunks, projected as
  `GatewayUsageMetadata` (`promptTokens` = input, `completionTokens` = output,
  `thoughtsTokens` = reasoning, `totalTokens`). There is **no cache-token
  breakdown** on this channel.
- **`finishReason`** comes from the `finish` chunk; reasoning **signatures**
  come from the reasoning part's `providerMetadata` (cached per provider via
  `reasoningCache.ts` so split signatures survive across chunks).

## Lifecycle & configuration

### `ApiGatewayService` (`src/main/features/apiGateway/ApiGatewayService.ts`)

A `BaseService` — `@Injectable('ApiGatewayService')`,
`@ServicePhase(Phase.WhenReady)`, implements **`Activatable`** — registered one
line in `src/main/core/application/serviceRegistry.ts`. It owns the `ApiGateway`
HTTP server (`src/main/features/apiGateway`) and is the single authority for
running state.

| Hook | Responsibility |
|---|---|
| `onInit` | Register the start/stop/restart IPC handlers; subscribe to `feature.api_gateway.enabled` changes (toggling the preference activates/deactivates the gateway). |
| `onReady` | `shouldAutoStart()` → activate if `feature.api_gateway.enabled` **or** at least one agent exists. |
| `onActivate` | `ensureValidApiKey()` → `new ApiGateway()` → `start()` → publish `running = true`. On failure, tears down partial state and republishes `false`. |
| `onDeactivate` | `stop()` the server, publish `running = false`. |

`ensureValidApiKey()` generates a `cs-sk-<uuid>` key into
`feature.api_gateway.api_key` the first time it is missing.

All activation/deactivation flows through a self-held
[`createLatestReconciler`](../../../src/main/core/concurrency/README.md) — the
**sole** caller of `activate`/`deactivate`, driven by `onReady`, the
`feature.api_gateway.enabled` subscription, and the IPC `start`/`stop`/`restart`
(which set `desiredEnabled`, then `request()` + `await flush()`). It converges the
running state to the latest desired value (`getSnapshot` re-reads the actual
activated state every pass), so an opposing toggle that lands mid-transition can't
leave the gateway diverged from intent; a still-current failure isn't retried (no
spin). `restart()` is `stop()` then `start()`.

### Running state — Shared Cache, not IPC

`publishRunningState()` writes `feature.api_gateway.running` (boolean) into the
**Shared Cache** via `CacheService.setShared(...)`. **Main is authoritative**;
the renderer reads it reactively with `useSharedCache('feature.api_gateway.running')`.
There is deliberately **no status/config pull IPC** — pulling running state or
config over IPC would be an anti-pattern, since running lives in the shared
cache and config lives in the preference (DataApi) layer.

### IPC (imperative actions only)

| Channel (`IpcChannel`) | Value | Handler |
|---|---|---|
| `ApiGateway_Start` | `api-gateway:start` | `start()` → `{ success } \| { success:false, error }` |
| `ApiGateway_Stop` | `api-gateway:stop` | `stop()` |
| `ApiGateway_Restart` | `api-gateway:restart` | `restart()` (stop → start) |

Preload exposes these as `window.api.apiGateway.{start,stop,restart}`.

### Preferences (`feature.api_gateway.*`)

| Key | Type | Default | Notes |
|---|---|---|---|
| `feature.api_gateway.enabled` | `boolean` | `false` | Auto-start on launch / toggled from settings |
| `feature.api_gateway.host` | `string` | `'127.0.0.1'` | Bind address |
| `feature.api_gateway.port` | `number` | `23333` | TCP port (UI clamps 1000–65535) |
| `feature.api_gateway.api_key` | `string \| null` | `null` | Auto-generated `cs-sk-<uuid>` on first activate |

Migrated from v1 `redux/settings/apiServer.{enabled,host,port,apiKey}` via the
v2 preference migrators. Edit `classification.json` (not the generated schemas)
to change these — see the v2 data-classify toolchain.

### Renderer

`useApiGateway()` reads config (`enabled`/`host`/`port`/`apiKey`) from
preferences and `running` from the shared cache, exposes `loading`, and wraps
the three IPC actions plus `setApiGatewayEnabled` / `setApiGatewayConfig`. The
`ApiGatewaySettings` page renders the status indicator, start/stop/restart
controls, port input, server URL, the (copy/regenerate) API key, an
`Authorization` header example, and a link to `…/openapi`. All strings live
under the `apiGateway` i18n namespace.

## Authentication

`authorizeApiRequest(xApiKey, bearerToken)` (`middleware/auth.ts`), run from the
`/v1` guard's `beforeHandle`:

1. Token = trimmed `x-api-key` header (Anthropic style, takes priority) **or**
   `Authorization: Bearer <token>` (OpenAI style, parsed by `@elysia/bearer`).
2. No token → **401** `Unauthorized: missing credentials`.
3. No `feature.api_gateway.api_key` configured → **403** `Forbidden`.
4. Compare against the configured key with **`crypto.timingSafeEqual`**
   (length-checked first). Match → allow; mismatch → **403** `Forbidden`.

## Error handling

One root `onError` (`gatewayErrorHandler`) selects the response envelope by
request **path**, so every endpoint speaks its caller's dialect:

| Path prefix | Envelope | Builder |
|---|---|---|
| `/v1/messages` | Anthropic `{ type:'error', error:{ type, message } }` | `anthropicErrorHandler` |
| `/v1/chat`, `/v1/responses` | OpenAI `{ error:{ message, type, code } }` | `openaiErrorHandler` |
| everything else | Cherry REST `{ error:{ code, message, details? } }` | `restErrorHandler` |

`DataApiError`s (from the data-layer services backing models/knowledge) carry
their own `status`/`code` and are mapped straight into the selected envelope.
Built-in Elysia `VALIDATION` / `NOT_FOUND` / `PARSE` codes map to 400/404/400
(422 for REST validation). Unknown provider/runtime errors are shaped by
`transformAnthropicError` / `transformOpenAiError` — **status-driven**: they read
`statusCode` off the AI-SDK `SerializedError`, so a provider 401/429/… keeps its
real status and message instead of flattening to 500. Internal-error messages are
gated behind `isDev`, and the AI-SDK error extras (`stack` / `url` /
request+response bodies) are dropped — for both the JSON handlers and the
streaming `buildStreamErrorFrame`.

## Key invariants

- **Equal, non-persisting subscriber.** The gateway uses
  `promptStreamLifecycle` — its turns are not persisted, not broadcast as topic
  status, and not attachable. It shares the exact same `AiStreamManager` engine
  as the renderer and IM channels; nothing special-cases it upstream.
- **Assistant-agnostic.** No assistant/topic context. Sampling, client tools,
  and provider options ride as per-request `CallOverrides`.
- **Main owns running state.** `feature.api_gateway.running` in the Shared Cache is
  the one source of truth; the renderer mirrors it, never sets it.
- **Dialect is chosen by path, both directions.** Input format is fixed per
  route; output envelope (success and error) is chosen from the path, so a
  client always gets back the protocol it spoke.
- **Auth key is the persisted preference.** `feature.api_gateway.api_key`, compared
  timing-safe; auto-generated on first activation.

## Related references

- [AI Reference](../ai/README.md) — `AiStreamManager`, `streamPrompt`,
  `UIMessageChunk`, `buildAgentParams` / `CallOverrides`, the listener model
  (`SseListener`, `WebContentsListener`).
- [Service Lifecycle](../lifecycle/README.md) — `BaseService`, `Activatable`,
  `@ServicePhase`, `serviceRegistry.ts`.
- [Data Layer](../data/README.md) — Preference (`feature.api_gateway.*`) and Cache
  (`feature.api_gateway.running`) systems; `ProviderService`, `KnowledgeBaseService`.
```
