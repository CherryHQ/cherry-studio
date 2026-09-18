---
description: Local HTTP gateway for OpenAI, Anthropic, Gemini, Cherry REST, and MCP-compatible clients
sources:
  - src/main/features/apiGateway
  - src/renderer/hooks/useApiGateway.ts
  - src/renderer/pages/settings/ToolSettings/ApiGatewaySettings
  - src/renderer/pages/settings/DeviceConnectionsSettings
---

# API Gateway Reference

The **API Gateway** exposes Cherry Studio's AI capabilities over a local HTTP
server that speaks the **OpenAI**, **Anthropic**, and **Gemini** wire protocols,
plus Cherry REST and Streamable HTTP MCP endpoints. Compatible clients can point at
`http://127.0.0.1:23333` and drive whatever provider/model the desktop app has
configured — Cherry becomes a universal translation gateway in front of every
provider it knows.

Generation requests route through main's `AiStreamManager` as equal,
**non-persisting** subscribers (alongside the renderer's `WebContentsListener`
and the IM `ChannelAdapterListener`), and the resulting `UIMessageChunk` stream
is translated back into the caller's dialect by the adapter system. Models,
knowledge, and MCP routes call their owning services directly.

> **Naming.** React components and the lifecycle service use `apiGateway`;
> IpcApi routes use `api_gateway.*`; Preference and Shared Cache keys use
> `feature.api_gateway.*`. The retired `csaas` alias is not part of the current
> surface.

## Where the code lives

```
src/main/features/apiGateway/        ← the HTTP server (Elysia + @elysia/node)
├── server.ts                        ← `ApiGateway` class: listen / stop, http timeouts
├── app.ts                           ← `buildApp()`: CORS, OpenAPI docs, request-id, error handler, route mounting
├── openapiDocs.ts                   ← localized OpenAPI generation and Scalar page
├── errors.ts                        ← `gatewayErrorHandler` (path → anthropic/openai/google/rest envelopes),
│                                       `buildStreamErrorFrame` (streaming error/timeout frames), `transformOpenAiError`
├── ApiGatewayService.ts             ← lifecycle owner, preference intent, leases, running-state reconciler
├── McpSessionStore.ts               ← bounded live Streamable HTTP MCP sessions
├── proxyStream.ts                   ← `processMessage()` — the core request → stream → response engine
├── reasoningCache.ts                ← google / openrouter reasoning-signature caches
├── openrouter.ts                    ← OpenRouter `reasoning_details` type contract (used by reasoningCache)
├── ApiGatewayPairing.ts             ← single-use LAN pairing codes → hashed device records
├── pairedDeviceToken.ts             ← device-token generation + hashing
├── middleware/
│   └── auth.ts                      ← desktop API-key auth + the separate paired-device guard
├── routes/
│   ├── messages.ts                  ← POST /v1/messages, POST /v1/messages/count_tokens (Anthropic)
│   ├── chat.ts                      ← POST /v1/chat/completions (OpenAI Chat)
│   ├── responses.ts                 ← POST /v1/responses (OpenAI Responses)
│   ├── gemini.ts                    ← POST /v1beta/models/{model}:{method}
│   ├── models.ts                    ← GET  /v1/models
│   ├── knowledge.ts                 ← GET/POST /v1/knowledge-bases[/search|/:id]
│   ├── mcp.ts                       ← MCP catalog + Streamable HTTP proxy
│   ├── pairing.ts                   ← POST /pair (public LAN pairing bootstrap)
│   ├── providerExport.ts            ← GET /v1/export/providers (paired-device provider export)
│   └── schemas.ts                   ← loose Zod body schemas (validate only what the gateway needs)
├── tokens/                          ← Anthropic/Gemini token estimation and wire-tool projections
├── utils/
│   └── models.ts                    ← `getModels()` — the /v1/models data path (never throws)
└── adapters/
    ├── interfaces.ts                ← `IMessageConverter` / `IStreamAdapter` / `ISseFormatter` contracts
    ├── converters/                  ← input dialect → AI SDK `UIMessage[]` + tools + options
    ├── stream/                      ← `UIMessageChunk` → output dialect events (push API)
    ├── formatters/                  ← output event → SSE wire string
    └── factory/                     ← `MessageConverterFactory`, `StreamAdapterFactory`

src/shared/ipc/schemas/apiGateway.ts      ← lifecycle commands, pairing offer, and event contracts
src/main/ipc/handlers/apiGateway.ts       ← thin lifecycle-service adapters
src/main/data/services/ApiGatewayPairedDeviceService.ts ← paired-device persistence + token lookup
src/renderer/hooks/useApiGateway.ts       ← renderer state (config + running + loading) and actions
src/renderer/pages/settings/ToolSettings/ApiGatewaySettings/   ← API client settings UI
src/renderer/pages/settings/DeviceConnectionsSettings/         ← LAN pairing and paired-device access UI
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
| `POST /pair` | One-time LAN pairing code → device token |

`POST /pair` accepts a 32-character lowercase hexadecimal code and caps the
request body at **4 KiB**, counted from the stream before JSON parsing, including
requests without `Content-Length`. Oversized requests receive `413` and close
the connection; other gateway routes do not inherit this limit.

> **Offline note.** `renderDocsPage` points Scalar at a pinned jsDelivr bundle,
> so `GET /openapi` (the human docs UI) needs network. `GET /openapi/json` — the
> machine-readable spec that programmatic clients/SDKs consume — is always
> served locally and is unaffected.

### Protected API routes

Mounted under a single `Elysia({ prefix: '/v1' })` that `.use(bearer())` and
applies a **`scoped`** auth guard — so the guard covers every `/v1` plugin but
none of the public routes above. Gemini's `/v1beta` group has its own local
guard, described below.

| Method & path | Dialect | In → out format |
|---|---|---|
| `POST /v1/messages` | Anthropic | `anthropic` → `anthropic` |
| `POST /v1/messages/count_tokens` | Anthropic | token estimate over the converted request; anthropic-dialect endpoints forward it to the provider's own `count_tokens` (via the app proxy/auth), other dialects stay local; no stream |
| `POST /v1/chat/completions` | OpenAI Chat | `openai` → `openai` |
| `POST /v1/responses` | OpenAI Responses | `openai-responses` → `openai-responses` |
| `POST /v1beta/models/{provider:model}:generateContent` | Gemini | `gemini` → Gemini JSON |
| `POST /v1beta/models/{provider:model}:streamGenerateContent?alt=sse` | Gemini | `gemini` → Gemini SSE |
| `POST /v1beta/models/{provider:model}:countTokens` | Gemini | local converted-request estimate |
| `GET /v1/models` | OpenAI list | `{ object:'list', data:[…] }`, ids are `providerId:modelId` (offset/limit) |
| `GET /v1/knowledge-bases` | Cherry REST | list (offset/limit) |
| `POST /v1/knowledge-bases/search` | Cherry REST | semantic search across bases |
| `GET /v1/knowledge-bases/:id` | Cherry REST | single base |
| `GET /v1/mcps` | Cherry REST | active MCP server catalog with gateway URLs |
| `GET /v1/mcps/:id` | Cherry REST | one active server plus its warmed tool catalog |
| `POST /v1/mcps/:id/mcp` | MCP Streamable HTTP | initialize/session request or sessionless one-shot JSON-RPC |
| `GET /v1/export/providers` | Cherry mobile export | enabled providers + enabled credentials/models; paired-device Bearer token only |

The model in every chat/messages/responses body is `"<providerId>:<modelId>"`
(split on the **first** `:`), e.g. `anthropic:claude-sonnet-4-6`.

Gemini routes carry a separate local auth guard because Gemini clients use
`x-goog-api-key` or `?key=`. The `/v1` scoped guard must not intercept `/v1beta`.

The provider-export route also carries a separate local guard and is mounted
before the broad `/v1` group. Its credential-bearing response is available only
to a paired device token, never the desktop gateway API key, and is marked
`Cache-Control: no-store`.

The MCP proxy validates browser `Origin` as loopback-only to prevent DNS
rebinding. Native clients normally send no `Origin`. Live sessions are bounded
and owned by `McpSessionStore`; GET carries server push and DELETE terminates a
session.

### LAN exposure is confined to pairing + export

The local gateway keeps its configured port (default `23333`) on loopback.
Enabling LAN access starts a separate `ApiGateway` listener on `0.0.0.0` with an
OS-assigned port; the pairing offer reports that actual port. Disabling LAN
closes only that listener and invalidates its pairing code. Existing local
streams and new local requests continue on the original listener.

Both listeners reuse `buildApp()`. A root `onRequest` guard (`lanGuard.ts`)
screens each request by its socket peer: loopback and in-process callers are
unrestricted, but a **non-loopback (LAN) peer may reach only `POST /pair` and
`GET /v1/export/providers`** — everything else returns `403`. The desktop's own
consumers use the configured local port; `gatewayClientOrigin` maps the LAN
preference `0.0.0.0` back to `127.0.0.1`.

The guard also checks the current LAN configuration on every remote request.
Disabling LAN first restores `feature.api_gateway.host` to `127.0.0.1`, so new
remote requests receive `403` while the LAN listener drains and closes.

## Request flow (generation routes)

The OpenAI, Anthropic, and Gemini generation routes call
`processMessage({ params, inputFormat, outputFormat, signal })` in
`proxyStream.ts`. That function is the heart of the gateway:

1. **Resolve model.** Read `params.model`, split on the first `:` into
   `providerId` / `modelId`, build a `uniqueModelId` via `createUniqueModelId`.
   `params.stream === true` selects streaming vs. JSON.
2. **Validate trusted Agent history.** After the request proves it is an
   internal Agent request, Anthropic-format history is checked before conversion.
   Deeply identical duplicate `tool_use` / `tool_result` blocks are
   losslessly folded; conflicting reuse of an ID returns HTTP 400. This condition
   depends only on the internal proof and Anthropic input format, not the target
   provider.
3. **Convert input.** `MessageConverterFactory.create(inputFormat, …)` returns
   the dialect's `IMessageConverter`, which yields:
   - `toUIMessages(params)` → AI SDK `UIMessage[]` (a system/instructions
     prompt becomes a leading `role: 'system'` message).
   - `toAiSdkTools(params)` → a `ToolSet` of **client tools** (no `execute`):
     the model emits the call and the gateway forwards it to the caller.
   - `extractStreamOptions(params)` → sampling (`temperature`, `topP`,
     `topK`, `maxOutputTokens`, `stopSequences`).
   - `extractProviderOptions(provider, params)` → reasoning/thinking options
     (the `Provider` is loaded best-effort from `ProviderService`).
4. **Assemble overrides.** Sampling + tools + provider options are merged into a
   single `CallOverrides` object — the gateway is **assistant-agnostic**, so
   everything is passed per-request (merged at highest precedence inside
   `buildAgentParams`).
5. **Pick the output adapter.** `StreamAdapterFactory.createAdapter(outputFormat)`
   + `.getFormatter(outputFormat)` give the `IStreamAdapter` (state machine that
   turns `UIMessageChunk`s into dialect events) and the `ISseFormatter` (event →
   SSE string).
6. **Drive the stream.** With `streamId = "gateway-<uuid>"`, call
   `AiStreamManager.streamPrompt({ streamId, uniqueModelId, messages, listener,
   callOverrides, contextOwner: 'caller', idleTimeoutMs })`. Caller ownership
   keeps externally managed history out of Cherry's context-build and in-loop
   compaction middleware. This uses the **`promptStreamLifecycle`** — no status
   broadcast, no attach/reconnect, no persistence; the stream evicts immediately
   at terminal.
   - **Streaming**: an `SseListener` with a push-API `formatChunk` /
     `formatDone` / `formatPaused` / `formatError` pipes the adapter's events
     through the formatter into a `text/event-stream` `ReadableStream`. The
     response is withheld behind a startup-commit barrier until the first
     provider-semantic chunk or clean completion; protocol scaffolding such as
     `start` is buffered but does not commit HTTP 200.
   - **Non-streaming**: a plain `StreamListener` feeds every chunk into the
     adapter to accumulate state, then `adapter.buildNonStreamingResponse()` is
     returned as a JSON `Response`.
7. **Abort & timeout.** The route's `request.signal` (client disconnect) calls
   `aiStreamManager.abort(streamId, …)`. An idle (no-chunk) timeout —
   **20 minutes** (`GATEWAY_STREAM_IDLE_TIMEOUT_MS`) — and any mid-stream abort
   surface as a **failure**, not a truncated success. Before streaming response
   commitment, an upstream pause rejects with **504**; after commitment it emits
   a per-dialect error frame (`buildStreamErrorFrame`). Non-streaming requests
   return **504**. The server's per-request timeout is **5 minutes** (`server.ts`),
   with `setTimeout(0)` so live SSE connections are not socket-timed-out.

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

### Streaming response commitment

A streaming request has two error regimes:

- **Before commitment:** `processMessage` has not returned its `Response` yet.
  Adapter-generated startup frames remain buffered. A provider error rejects
  with the original serialized error, so the route returns its real HTTP status
  and dialect envelope (for example, HTTP 400 or 503). An idle-timeout pause
  rejects as HTTP 504. AI SDK `start`, step, metadata, partial tool-input, and
  tool-output chunks do not commit the response.
- **After commitment:** once text/reasoning output, an available tool call, a
  finish chunk, or clean completion commits HTTP 200, headers can no longer
  change. A later error or pause therefore emits the dialect's terminal SSE
  error frame and closes the stream.

Client disconnect before commitment abandons the pending response, clears its
startup buffer, aborts the manager execution, and does not surface a gateway
error. The gateway never transparently retries after commitment because doing
so could duplicate model output or tool side effects.

## Adapter system

Two independent dialect axes, chosen by `inputFormat` / `outputFormat`:

| Role | Interface | Implementations |
|---|---|---|
| **Converter** (input → AI SDK) | `IMessageConverter` | `anthropic`, `openai`, `openai-responses`, `gemini` |
| **Stream adapter** (`UIMessageChunk` → events) | `IStreamAdapter` | Anthropic, OpenAI Chat, OpenAI Responses, Gemini adapters |
| **Formatter** (event → SSE string) | `ISseFormatter` | Anthropic, OpenAI Chat, OpenAI Responses, Gemini formatters |

The output formats are **`anthropic`**, **`openai`**, **`openai-responses`**, and **`gemini`**
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
line in `src/main/core/application/serviceRegistry.ts`. It owns the local and
LAN `ApiGateway` HTTP listeners (`src/main/features/apiGateway`) and is the
single authority for their running state.

| Hook | Responsibility |
|---|---|
| `onInit` | Subscribe to `feature.api_gateway.enabled`; IpcApi handlers live in `src/main/ipc/handlers/apiGateway.ts`. |
| `onReady` | Read the persisted desired state and flush the reconciler. |
| `onActivate` | Start the local listener at the configured port (`0.0.0.0` maps to loopback), then restore LAN if enabled. A LAN restore failure leaves the local gateway running. |
| `onDeactivate` | Clear the live pairing code, stop both listeners, publish both running states as `false`. |

`ensureValidApiKey()` generates a `cs-sk-<uuid>` key into
`feature.api_gateway.api_key` the first time it is missing.

All activation/deactivation flows through a self-held
[`createLatestReconciler`](../../../src/main/core/concurrency/README.md), the
sole caller of `activate`/`deactivate`. It is driven by `onReady`, Preference
changes, IpcApi actions, and temporary run leases, converging actual state to
`desiredEnabled || leaseCount > 0`. A temporary consumer can therefore keep the
server up without persisting an enabled intent. Start/stop persist user intent
before convergence; restart rebinds only when no lease is active.

LAN commands are serialized with listener cleanup. Enabling LAN requires an
enabled, running local gateway; it binds the new listener before persisting
`host = 0.0.0.0`. A bind or preference-write failure closes the new listener
without changing the local gateway's enabled intent. Disabling LAN persists
`host = 127.0.0.1` and stops only the LAN listener.

An explicit gateway stop atomically persists `enabled = false` and the return
from LAN to loopback, then closes the LAN listener and clears its pairing code.
A `deferred` stop preserves the local listener for existing task leases; the
final lease release stops it. A later ordinary gateway start stays on loopback.
An explicit restart retains LAN intent, but creates a new LAN listener whose
port may differ; mobile clients must obtain its new endpoint from a fresh QR.

### Running state — Shared Cache, not IPC

`publishRunningState()` writes `feature.api_gateway.running` (boolean) into the
**Shared Cache** via `CacheService.setShared(...)`. It also publishes
`feature.api_gateway.lan_running` for the LAN listener. **Main is authoritative**;
the renderer reads it reactively with `useSharedCacheValue('feature.api_gateway.running')`.
There is deliberately **no status/config pull IPC** — pulling running state or
config over IPC would be an anti-pattern, since running lives in the shared
cache and config lives in the Preference subsystem.

### IpcApi (imperative actions only)

| Route | Result | Handler |
|---|---|---|
| `api_gateway.start` | `{ success } \| { success:false, error }` | `ApiGatewayService.start()` |
| `api_gateway.stop` | success includes `outcome: 'stopped' \| 'deferred'` | `ApiGatewayService.stop()` |
| `api_gateway.restart` | `{ success } \| { success:false, error }` | `ApiGatewayService.restart()` |
| `api_gateway.lan.set_enabled` | `void`; failures use the standard IpcApi error channel | `ApiGatewayService.setLanEnabled(enabled)` |
| `api_gateway.create_pairing_offer` | active LAN endpoint + one-time code; failures use the standard IpcApi error channel | `ApiGatewayService.createPairingOffer()` |

`api_gateway.required` is a Main-to-renderer event for an Agent session whose
model must use the gateway while the user's persisted gateway intent is off.
`api_gateway.pairing_completed` is a payload-free signal that clears an
already-consumed QR code in every settings window.

### Preferences (`feature.api_gateway.*`)

| Key | Type | Default | Notes |
|---|---|---|---|
| `feature.api_gateway.enabled` | `boolean` | `false` | Auto-start on launch / toggled from settings |
| `feature.api_gateway.host` | `string` | `'127.0.0.1'` | `0.0.0.0` requests the separate LAN listener; the local listener stays on loopback |
| `feature.api_gateway.port` | `number` | `23333` | Local TCP port (UI clamps 1000–65535); LAN uses an OS-assigned port |
| `feature.api_gateway.api_key` | `string \| null` | `null` | Auto-generated `cs-sk-<uuid>` on first activate |

Migrated from v1 `redux/settings/apiServer.{enabled,host,port,apiKey}` via the
v2 preference migrators. Edit `classification.json` (not the generated schemas)
to change these — see the v2 data-classify toolchain.

### Renderer

`useApiGateway()` reads config (`enabled`/`host`/`port`/`apiKey`) from
Preferences and `running` from the shared cache, exposes `loading`, and wraps
the three IpcApi actions plus `setApiGatewayConfig`. Main owns writes to the
`enabled` key inside start/stop so persisted intent and runtime state cannot diverge. The
`ApiGatewaySettings` page renders the status indicator, start/stop/restart
controls, port input, server URL, the (copy/regenerate) API key, an
`Authorization` header example, and a link to `…/openapi`.

The separate `DeviceConnectionsSettings` page owns LAN exposure, mobile pairing,
and access revocation. It only sends LAN enable/disable commands. When the local
gateway is disabled or not running, it offers a link to API Gateway settings.
The pairing section uses the same gateway-required guidance. If LAN intent is
enabled but its listener is down, the page offers Retry alongside Disable LAN
access so recovery does not require toggling the preference off first.
Its pairing section includes the plain-HTTP credential warning. It asks Main
for one atomic pairing offer, renders the QR, and uses DataApi to list or revoke
paired devices. Readiness requires both enabled LAN intent and the live LAN
running state. Its strings live under the `deviceConnections` i18n namespace.

Paired-device records are SQLite-backed business data in
`api_gateway_paired_device`. The raw `cs-dt-…` token is returned once by
`POST /pair`; only its SHA-256 hash is persisted. Renderer-facing DataApi returns
device metadata only (`GET /api-gateway/paired-devices`) and exposes revocation
as `DELETE /api-gateway/paired-devices/:id`.
The owning data service validates device metadata before insertion; the HTTP
pairing body reuses the same entity-derived metadata schema.

### Mobile pairing protocol

The QR code contains JSON, not a URL:

```json
{"v":1,"t":"cherry-studio-pair","name":"Desktop","port":34444,"ips":["192.168.1.8"],"code":"0123456789abcdef0123456789abcdef"}
```

`v` is the QR format version; `t` identifies a Cherry Studio pairing payload.
`name` is the desktop hostname. `ips` contains its non-loopback IPv4 addresses;
the mobile client must choose an address reachable on its network and use
`http://<ip>:<port>` as the gateway origin. `port` is the active LAN listener
port, not the configured local API port; it can change after re-enabling LAN or
restarting the gateway. The code is valid for five minutes, is consumed by the
first successful pairing, and is invalidated after ten wrong attempts, disabling
LAN, or a gateway stop/restart. Displaying it again before expiry reuses the same
live code. Disabling LAN, stopping the gateway, completing pairing, or leaving
the page invalidates pending QR requests in the renderer so a late response
cannot restore an old QR.

Send the code with the mobile device's metadata, without an authorization header:

```http
POST /pair
Content-Type: application/json

{"code":"0123456789abcdef0123456789abcdef","device":{"name":"My phone","platform":"android"}}
```

The device name and platform are trimmed, non-empty strings, limited to 64 and
32 characters respectively; `platform` is not an enum. A successful response is
`200` with `{ "token": "cs-dt-…", "name": "Desktop", "version": "2.0.0" }`.
Here `version` is the desktop app version, not the QR format version. Malformed
JSON receives `400`, invalid device metadata receives `422`, an invalid/expired
code receives `403`, and a body over 4 KiB receives `413`. The token is returned
only once and remains valid until the desktop user revokes that device;
disabling LAN or stopping the gateway does not delete it.

Use `Authorization: Bearer <token>` for `GET /v1/export/providers`. Its response
is `{ "version": 1, "providers": [...] }`, containing enabled providers with
enabled API keys and models, authentication configuration, and portable request
settings. The exact field projection lives in
[`providerExport.ts`](../../../src/main/features/apiGateway/routes/providerExport.ts).
Missing credentials receive `401`; unknown or revoked tokens receive `403`.
After revocation, the device must pair again. Both mobile routes are hidden from
OpenAPI. Disabling LAN closes its listener; requests arriving during shutdown
receive `403`.
Transfers use plain HTTP and include provider secrets; the successful export
response carries `Cache-Control: no-store`.

## Authentication

`authorizeApiRequest(xApiKey, bearerToken)` (`middleware/auth.ts`), run from the
`/v1` guard's `beforeHandle`:

1. Token = trimmed `x-api-key` header (Anthropic style, takes priority) **or**
   `Authorization: Bearer <token>` (OpenAI style, parsed by `@elysia/bearer`).
2. No token → **401** `Unauthorized: missing credentials`.
3. No `feature.api_gateway.api_key` configured → **403** `Forbidden`.
4. Compare against the configured key with **`crypto.timingSafeEqual`**
   (length-checked first). Match → allow; mismatch → **403** `Forbidden`.

The `/v1beta` guard passes Gemini's `x-goog-api-key` / `?key=` token as a third
candidate to the same timing-safe comparison and shapes guard failures in the
Google error envelope.

Paired-device authentication is deliberately separate. A `cs-dt-…` Bearer
token is hashed and looked up only by the local guard on
`GET /v1/export/providers`; it does not grant access to the existing `/v1` or
`/v1beta` routes. Future mobile-only endpoints opt into this guard explicitly.

## Error handling

One root `onError` (`gatewayErrorHandler`) selects the response envelope by
request **path**, so every endpoint speaks its caller's dialect:

| Path prefix | Envelope | Builder |
|---|---|---|
| `/v1/messages` | Anthropic `{ type:'error', error:{ type, message } }` | `anthropicErrorHandler` |
| `/v1/chat`, `/v1/responses` | OpenAI `{ error:{ message, type, code } }` | `openaiErrorHandler` |
| `/v1beta` | Google `{ error:{ code, message, status } }` | `googleErrorHandler` |
| everything else | Cherry REST `{ error:{ code, message, details? } }` | `restErrorHandler` |

`DataApiError`s (from the data-layer services backing models/knowledge) carry
their own `status`/`code` and are mapped straight into the selected envelope.
Built-in Elysia `VALIDATION` / `NOT_FOUND` / `PARSE` codes map to 400/404/400
(422 for REST validation). Explicit HTTP responses thrown by custom parsers,
such as the pairing body's `413`, are preserved through Elysia's `ParseError` wrapper.
Unknown provider/runtime errors are shaped by
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
  as the renderer and IM channels.
- **Caller-owned history.** Gateway clients own their context. The gateway sets
  `contextOwner: 'caller'`, so Cherry does not truncate tool results, prune or
  window messages, or run summary compaction. Protocol conversion and provider
  serialization still run normally.
- **Assistant-agnostic.** No assistant/topic context. Sampling, client tools,
  and provider options ride as per-request `CallOverrides`.
- **Main owns running state.** `feature.api_gateway.running` in the Shared Cache is
  the one source of truth; the renderer mirrors it, never sets it.
- **Generation dialect is chosen by path, both directions.** Input format is
  fixed per route; output envelope (success and error) is chosen from the path,
  so a generation client gets back the protocol it spoke.
- **Auth key is the persisted preference.** `feature.api_gateway.api_key`, compared
  timing-safe; auto-generated on first activation.
- **Paired tokens are endpoint-scoped.** They authorize only the provider-export
  route today, are stored as hashes, and never become a fallback credential for
  existing gateway routes.

## Related references

- [AI Reference](../ai/README.md) — `AiStreamManager`, `streamPrompt`,
  `UIMessageChunk`, `buildAgentParams` / `CallOverrides`, the listener model
  (`SseListener`, `WebContentsListener`).
- [Service Lifecycle](../lifecycle/README.md) — `BaseService`, `Activatable`,
  `@ServicePhase`, `serviceRegistry.ts`.
- [Data Layer](../data/README.md) — Preference (`feature.api_gateway.*`), Cache
  (`feature.api_gateway.running`), paired-device DataApi records, and the
  `ProviderService` / `KnowledgeBaseService` owners.
