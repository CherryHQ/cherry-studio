---
description: JSON-RPC 2.0 remote API with Agent contracts, incremental events, resumable subscriptions, command receipts, and portable package exports
sources:
  - src/main/features/apiGateway
  - src/main/ai/streamManager
  - src/main/ai/agentSession/AgentSessionRuntimeService.ts
  - src/main/data/services
  - src/main/data/services/AgentSessionMessageService.ts
  - src/shared/ai/transport
---

# Remote Agent API Design

> **Status: target API for a rewrite, not the current implementation.**
> The old separate LAN listener, `/remote/v1/connect`, provider-token authorization,
> custom static-key frames, unprefixed methods, and periodic snapshots are not
> compatibility constraints. This document defines the proposed replacement;
> implementing schemas, selecting the crypto profile, and cross-platform validation
> are still required before protocol v1 can be frozen or advertised as supported.

The [architecture proposal](../api-gateway/remote-agent-access.md) owns deployment,
pairing policy, security, and package boundaries. This document is the single
catalog of target network methods, data contracts, delivery semantics, and public
package exports. The existing source paths above identify rewrite integration
points; they do not imply these APIs exist today.

The accepted [shared-infrastructure decision](../api-gateway/remote-agent-access.md#shared-infrastructure-for-configuration-transfer-and-agent-access)
also places provider/model configuration transfer on this encrypted connection.
One pairing confirms the permitted business capabilities before success. The
Agent-only pairing/authentication and package examples below still need expansion
for that unified contract; they must not be frozen as a second Agent pairing flow.
Configuration-transfer methods and DTOs remain to be specified in this catalog.

See [Sequences and Modules](./remote-agent-sequences.md) for the target connection
state machine, module map, and thirteen normal/failure scenarios.
See [Implementation Design](./remote-agent-implementation.md) for proposed files,
function signatures, transaction boundaries, and resource ownership.
The [testing specification](./remote-agent-testing.md) defines local WebSocket
client acceptance scenarios and evidence requirements.

The #20717 prototype has been backed up and removed from the working tree.
Remote services and prototype-only owner extensions below are design targets or
archived references, not implemented baseline APIs.

## Connection and API surface

Expose one WebSocket upgrade route on the desktop API Gateway:

```text
GET /v1/remote/connect
```

Direct and relay clients use the same path and protocol. The route is generic;
Agent is its first domain. No separate remote REST history API is needed: history,
content, control, and events all travel inside the authenticated encrypted channel.
This also avoids leaking history through a TLS-terminating relay. No remotely
callable authorization-administration or arbitrary file-path API is exposed.

Connection progression:

```text
upgrade → encrypted authenticated handshake → connection.hello
        → pairing claim/poll OR connection.authenticate
        → authenticated domain requests and subscriptions
```

The handshake authenticates the pinned desktop and proves the connecting device
key, including a not-yet-approved key during pairing. Its selected crypto/profile
and offered/selected protocol versions are transcript-bound. `connection.hello`
confirms the same protocol version inside encryption; it does not negotiate
individual features or downgrade the handshake selection. No-overlap fails before business dispatch.
The architecture's crypto release gate defines requirements; binary handshake
bytes and token encoding remain pending profile selection.

### JSON-RPC 2.0 binding

Use the standard [JSON-RPC 2.0 specification](https://www.jsonrpc.org/specification)
for requests, responses, notifications, errors, and batch processing. There is no
outer `type`, `requestId`, or proprietary event envelope. Each decrypted application
record is one UTF-8 JSON value: a JSON-RPC object or bounded batch array. WebSocket
message boundaries carry records; do not add stdio `Content-Length` framing or NDJSON.
Encryption record framing remains part of the selected security profile.

```json
{
  "jsonrpc": "2.0",
  "id": "q1",
  "method": "agent.messages.send",
  "params": {
    "commandId": "c1",
    "sessionId": "s1",
    "text": "Hello",
    "expectedIdleRevision": "7"
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": "q1",
  "result": {
    "commandId": "c1",
    "method": "agent.messages.send",
    "status": "accepted",
    "admittedAt": "2026-09-21T08:00:00Z",
    "sessionId": "s1",
    "executionId": "e1"
  }
}
```

The JSON-RPC marker is always `"2.0"`; it is not the remote protocol version,
npm package version, app release version, or `/v1` route version. v1 has one
whole-protocol version, not separate wire and Agent-domain version axes. Request `id` correlates
one reply on one connection. Our clients generate unique string IDs and never
reuse them during that connection; the decoder preserves standard string, number,
and null IDs and never treats a missing ID as null. Business `commandId` remains
the durable deduplication key. A JSON-RPC timeout or local pending-call disposal
does not cancel desktop execution or prove a command was rejected.

All methods in the request tables use named object `params`; an empty-parameter
method accepts `{}` or omitted `params`. Positional arguments fail method validation
with `-32602`. Namespaces are `connection.*`, `pairing.*`, and `agent.*`; reserve
`rpc.*` for JSON-RPC itself. Results accept compatible optional additions; mutation
parameters reject unknown fields. The root package contains no Agent event union.

### Notifications and batches

Server events (`agent.events`, connection lifecycle, subscription reset) are
JSON-RPC notifications: they have `jsonrpc`, `method`, and `params`, with no `id`.
Never respond to a notification, even for unknown methods or invalid parameters.
An unknown negotiated stream event stops application and initiates recovery via
a separate request or connection close; it does not produce a notification reply.
Notifications are not ACKs. `agent.subscriptions.ack` remains a separate request
after atomic local state/cursor persistence, with cumulative semantics.

Our application profile requires request IDs for every method in the request
tables, including mutations, authentication, subscribe, and ACK. An ID-less call
to one of those methods is discarded before side effects and logged locally; no
error response is sent. The dispatcher enforces direction and connection state
before invoking a method. Mobile cannot call a server-only notification as a
business operation. Tool approval stays a durable interaction plus a respond
request, so losing a connection does not lose a pending reverse-RPC call.

Support standard JSON-RPC batches with a proposed ceiling of 16 entries plus the
record byte ceiling. Replies correlate by `id`, may be out of order, and omit
notifications; a notification-only batch produces no response. An empty array or
invalid batch member follows the standard invalid-request behavior. Batch execution
is neither ordered nor atomic: dependent calls wait for the preceding response.
Handshake negotiation and authentication must be completed before sending dependent
domain calls, even when a caller attempts to group them into a batch.

Apply admission/authorization/limits to each batch member, including notifications.
For a syntactically valid batch over the entry ceiling, reject all entries before
execution, with a `RESOURCE_EXHAUSTED` application error per request ID, standard
errors for invalid members, and no replies to notifications. Bound aggregate reply
size by each method's declared response budget; reject before dispatch if it cannot
fit one record. Oversized records close at the transport boundary. Batch support
must not bypass connection quotas or silently fragment a JSON-RPC response array.
If even the rejection response cannot fit the output ceiling, close before executing
any member. Authenticate/admit each call before reserving its response budget.
Our clients send independent single requests by default. `agent.events.params.events`
is an ordered domain event batch, distinct from a top-level JSON-RPC batch.
Desktop emits session notifications as individual records in cursor order.

For subscription activation in a batch, queue its resulting event notifications
until the containing response array has been sent. RPC responses need not preserve
request order; session events still obey their cursor order. A late response to a
timed-out ID cannot resolve a newer call; responses never receive error responses.

### Errors and application failures

Preserve the standard numeric JSON-RPC errors:

| Numeric code | Meaning |
|---|---|
| `-32700` | Parse error in decrypted JSON |
| `-32600` | Invalid JSON-RPC request |
| `-32601` | Method not found |
| `-32602` | Invalid method parameters |
| `-32603` | Sanitized internal error |

Use `id: null` when the request ID cannot be determined. Ciphertext authentication
failure is not a JSON parse error: close without dispatch. For application failures,
reserve code `1000` and put a stable reason in `error.data.reason`, outside the
JSON-RPC reserved error range. The later error table defines these reasons.

```json
{
  "jsonrpc": "2.0",
  "id": "q1",
  "error": {
    "code": 1000,
    "message": "The expected execution is no longer active",
    "data": {
      "reason": "CONFLICT",
      "details": { "sessionId": "s1" }
    }
  }
}
```

`error.data` may also include `retryAfterMs` and method-defined safe `details`.
The root JSON-RPC error schema accepts standard `data: unknown`; the application
error validator checks our code-1000 shape and domain validators check its details.
This avoids pretending that every JSON-RPC peer uses our error extensions.

Stored command/execution failures are domain values, not nested RPC responses:
`RemoteFailure = { reason, message, retryAfterMs?, details? }`. A successful
`agent.commands.get` can return a rejected receipt with `result.error: RemoteFailure`.
Transport error and stored command outcome must remain distinguishable.

Unknown required semantics fail instead of being silently ignored. Methods and
event kinds belong to the selected complete protocol version; do not emit a newer
version's semantics on an older connection. The implemented failure extension is
advertised separately as `agentFailureVersion: 1`; clients gate Agent failure recovery on it.

All IDs are opaque strings. Sequences, revisions, byte offsets and byte lengths
are canonical unsigned decimal strings, compared numerically, never as JS numbers
or lexicographically. Timestamps use UTC RFC 3339 strings. Limits/counts are bounded
integers. Pagination cursors are opaque, authorization-bound, expiring, and bound
to query filters; clients never decode them. Digests use lowercase hex SHA-256.

### Common methods

| Method | Params | Result | Allowed state |
|---|---|---|---|
| `connection.hello` | `{ protocolVersions: [1] }` | `{ protocolVersion: 1, agentFailureVersion: 1, limits, heartbeatMs }` | After handshake, once |
| `pairing.claim` | `{ invitationId, invitationSecret, deviceName, platform, capabilities }` | `{ claimId, verificationCode, expiresAt }` | Negotiated, not authenticated |
| `pairing.get` | `{ claimId }` | `{ status: 'pending' \| 'rejected' \| 'expired' }` or `{ status: 'approved', deviceId, authorization, accessToken, expiresAt }` | Same proven device key as claim |
| `connection.authenticate` | `{ deviceId, accessToken? }` | `{ deviceId, authorization, accessToken, expiresAt }` | Negotiated; proven device key must own current device authorization |
| `connection.refresh` | `{}` | `{ accessToken, authorization, expiresAt }` | Same authenticated device and enabled authorization |
| `connection.ping` | `{ nonce }` | `{ nonce, serverTime }` | Negotiated |

### Protocol version compatibility

`protocolVersions` is a bounded, nonempty list of supported positive integer
versions. The hello table shows the only initial value, `[1]`. Each advertised
version means the **complete** contract: v1 includes incremental events, replay /
checkpoint recovery, ACK and command receipts. Pairing requests explicit `capabilities`
(`agent` and/or `configuration`) and grants are independent. `agentFailureVersion: 1` is required for the implemented Agent failure
contract; it does not gate configuration transfer. There is no snapshot-polling fallback.
Limits are server-advertised resource budgets checked against the client's hard bounds, not
optional feature switches.

The desktop selects the highest common explicitly supported version and the client
checks that it offered that version and that it matches the secure handshake.
Only list versions actually implemented and tested; version 2 never implies support
for version 1. A future implementation may explicitly retain both `[1, 2]`, but the
first release implements only `[1]`, without speculative compatibility adapters.

No common version returns code `1000`, reason `UPGRADE_REQUIRED`, with bounded
`{ supportedProtocolVersions }` details, then stops before device authentication or
business dispatch. A selected version not offered by the client is a protocol
failure. Explain that the installed releases have no common protocol and need a
compatible update; reconnect loops cannot fix this. Do not infer that the app with
a smaller release number is necessarily the incompatible side.

`connection.hello` keeps a bounded bootstrap request/error shape across supported
versions; freeze it before v1. The reviewed security profile must bind the complete
offer and selection and provide a safe mismatch outcome. If incompatibility prevents
completing the secure handshake, fail there rather than claiming an encrypted hello
error was delivered. No plaintext business fallback is allowed.

Version selection happens once per connection and again after reconnect. The
projection profile is determined by the selected protocolVersion, not negotiated
separately. Key cached projections/cursors by that version. Changing protocol
versions requires a new checkpoint; never feed an old-version cursor to a different
reducer. Pending commands retain their original body, ID and protocol version:
reconcile them using the original version before switching when supported. If that
version is no longer supported, leave the outcome unresolved for reconciliation;
do not silently convert and resubmit the command under a new schema.

Mobile and Desktop app releases, npm package semver, and protocol versions evolve
independently. Different app releases can interoperate using the same protocol.
Compatible optional response fields can be added without changing the version if
old consumers safely ignore them; mutation schemas still reject unknown fields.
New methods/event variants, new required fields, or changed reducer/command identity
semantics require a new protocol version unless a later, explicitly designed
extension mechanism governs them. Do not add capability negotiation until a real
optional feature needs it.

| Mobile supports | Desktop supports | Result |
|---|---|---|
| `[1]` | `[1]` | Use complete v1, even with different app/package releases |
| `[1]` | `[1, 2]` | Use complete v1; Desktop keeps its v1 behavior |
| `[1, 2]` | `[1]` | Use complete v1; Mobile does not call v2 methods |
| `[1, 2]` | `[1, 2]` | Use complete v2 |
| `[1]` | `[2]` | No common version; require a compatible update |

Rows mentioning v2 describe future compatibility rules, not a currently supported
version. Retaining old versions is an explicit tested implementation commitment,
not automatic N-1 compatibility. Deprecation/removal must record affected released
Mobile/Desktop versions; no automatic switch to a partially implemented protocol.

Pairing retries with the same invitation and device key return the same pending
claim. An invitation admits only one claimant; other keys cannot consume its
approval. The local desktop user approves/rejects the displayed claim; no remote
`pairing.approve` exists. Poll results containing a token remain retrievable only
by that key until the claim's expiry. Expired recovery requires a new invitation.
The verification code and claim are bound to the invitation and proven keys by
the selected security profile. Names are display metadata, never identity proof.

One connection authenticates one device and its current authorization generation
(`grantId`). Each device has at most one enabled Agent authorization; there is no
grant selection or scope configuration. A new generation requires a new connection.
With a token, authenticate verifies its key/generation binding, expiry and the
currently enabled device authorization. Without one, the desktop uses the handshake's
device-key proof plus that stored authorization to issue a fresh token; knowing a
grant ID alone grants nothing. This also handles a long offline period: discard the
expired token and authenticate the same enabled generation with the approved key.
A revoked generation/key is rejected on both paths and requires new desktop approval.
Refresh rechecks enabled state and rotates the short-lived token without changing
grantId. After token expiry, domain delivery stops; allow only refresh/ping for a
bounded grace period, then close. Revocation closes immediately.
An encrypted `connection.authRequired` event carries `{ expiresAt }` before expiry;
`connection.closing` carries `{ reason, retryAfterMs? }`. These are connection
notifications without replay cursors. The client reconnects when the socket dies
even if it never receives either event.

## Authorization and resource DTOs

```ts
type AgentAuthorization = {
  domain: 'agent'
  grantId: string
}
type AgentCursor = { sessionId: string; streamEpoch: string; seq: string }
type ContentRef = {
  contentId: string
  revision: string
  byteLength: string
  mediaType: string
  sha256: string
}
type Page<T> = { items: T[]; nextCursor: string | null }
```

Agent access is a single desktop-approved device switch. While enabled, that device
can view and control all Agent sessions exposed by this desktop API, including
sessions created later: read, create, send, respond to approvals, and cancel. v1 has
no per-Agent/session/workspace allowlists and no separate view/send/approve choices.
It does not expose provider secrets, Agent configuration, or arbitrary filesystem
access; normal resource existence, lifecycle, runtime and concurrency checks remain.
Tool decisions still apply to individual pending interactions, never blanket approval.

Persist this state on the existing paired-device record, separately from provider
pairing: `agentRemoteAccess: null | { grantId, status: 'enabled' | 'revoked' }` plus
its proven device-key binding. Null means never approved. `grantId` is an opaque,
never-reused authorization-generation ID, not a configurable permission resource.
Initial approval and approval after revocation allocate a fresh ID; token refresh,
reconnect and redundant enable while already enabled preserve it. No standalone
grant table, permission list or grant revision is required.

Revocation disables the current generation, closes its connections and invalidates
its pages/checkpoints. Reapproval never accepts old tokens, pending commands or
recovery handles as the new generation: commands/receipts and client caches remain
bound to `(deviceId, grantId)`. Clients must not relabel pending commands with a
new grant ID and resubmit automatically. The authenticated connection supplies this
identity; a request cannot select another device/generation through its params.

Reads still verify that messages, parts, interactions and content belong to the
specified session. Foreign/invalid resource or page handles return `NOT_FOUND`;
expired revisions retain their specific errors. These are resource-integrity checks,
not user-configurable scopes. Protocol compatibility and device authorization are
separate checks; neither negotiates per-feature or per-action capability lists.

| DTO | Public fields and meaning |
|---|---|
| `AgentSummary` | `agentId`, `name`; no prompts, provider keys, or runtime configuration |
| `WorkspaceSummary` | `workspaceId`, `name`; no absolute filesystem paths |
| `SessionSummary` | `sessionId`, `agentId`, `workspaceId`, `title`, `updatedAt`, `historyRevision`, `activeExecutionId?`, `idleRevision?` (present only when idle) |
| `Execution` | `executionId`, status, related command/message IDs, safe error if present; ID is unique across attempts and restarts |
| `Message` | `messageId`, `revision`, role, ordered stable `partId` values; no array-index addressing |
| `Part` | `partId`, `revision`, kind, kind-specific content/state, `executionId?`, `toolCallId?`; text/reasoning/tool input/output/file/data are explicit variants |
| `Interaction` | `interactionId`, `revision`, `executionId`, `toolCallId`, status, action summary, complete input inline or `ContentRef`, `inputDigest`, `expiresAt?` |

Part content is inline or an explicit revision-pinned `ContentRef`; it is never
silently shortened and presented as complete. Large tool output, files, or existing
content may be referenced to avoid unsolicited bulk downloads. Live text, reasoning,
and streamed tool-input text use append events; long text is not periodically
replaced by a cumulative snapshot. Clients can reconstruct all exposed content
through deltas plus explicit content reads. This is a wire guarantee, not a promise
to expose model-internal reasoning that the runtime does not provide.

## Agent request API

All methods below require the same enabled device-level Agent authorization. `PageParams` means
`{ cursor?: string, limit?: number }`. Collection pages return `Page<T>`.
`commandId` is required for every business mutation. The exact mutation body,
including concurrency preconditions, is part of its idempotency identity.

| Method | Params | Result |
|---|---|---|
| `agent.agents.list` | `PageParams` | `Page<AgentSummary>` |
| `agent.workspaces.list` | `{ agentId, ...PageParams }` | `Page<WorkspaceSummary>` |
| `agent.sessions.list` | `{ agentId?, workspaceId?, ...PageParams }` | `Page<SessionSummary>` |
| `agent.sessions.get` | `{ sessionId }` | `{ session: SessionSummary }` |
| `agent.sessions.create` | `{ commandId, agentId, workspace, title? }`; legacy `workspaceId` also accepted | `CommandReceipt` |
| `agent.messages.list` | `{ sessionId, historyRevision, ...PageParams }` | `Page<Message>` |
| `agent.parts.list` | `{ sessionId, messageId, messageRevision, ...PageParams }` | `Page<Part>` |
| `agent.content.read` | `{ sessionId, contentId, revision, offset, maxBytes }` | `{ contentId, revision, offset, dataBase64, nextOffset, eof, sha256 }` |
| `agent.messages.send` | `{ commandId, sessionId, text, expectedIdleRevision }` | `CommandReceipt` |
| `agent.executions.cancel` | `{ commandId, sessionId, expectedExecutionId }` | `CommandReceipt` |
| `agent.interactions.list` | `{ sessionId, ...PageParams }` | `Page<Interaction>` |
| `agent.interactions.get` | `{ sessionId, interactionId }` | `{ interaction: Interaction }` |
| `agent.interactions.respond` | `{ commandId, sessionId, interactionId, expectedRevision, expectedExecutionId, inputDigest, response }`; legacy `decision` also accepted | `CommandReceipt` |
| `agent.commands.get` | `{ commandId }` | `CommandReceipt` |

`workspace` is `{ kind: 'system' }` or `{ kind: 'registered', id }`. `response` is
`{ kind: 'approve' }`, `{ kind: 'deny', reason? }`, or `{ kind: 'answer', answers }`,
where `answers` maps each question text to its answer. A request chooses exactly one
modern or legacy form, never both.

`agent.commands.get` only returns receipts for the authenticated device and current
authorization generation, even though the device can view all exposed sessions.

`messages.send` accepts text only in v1; attachments and runtime steering are not
implicitly supported. It admits a new execution only if the session is idle at
`expectedIdleRevision`, a server-issued value from its synchronized session state.
Competing sends return `CONFLICT` rather than silently queueing/steering or starting
a second run. A client must synchronize before sending. Admission owns the session
reservation so a locally started run cannot race past this precondition. A future
queue/steer API needs explicit semantics and a new protocol version; v1 does not
advertise optional queue/steer support.

History is paged at one `historyRevision` supplied by a checkpoint or current
session read. Subsequent pages are immutable at that revision or fail with
`REVISION_EXPIRED`; they never mix newer rows into an older traversal. Message part
pages similarly bind `messageRevision`. Stable IDs reconcile live and stored
messages without duplicating them. List pages outside history are bounded views,
not a global transaction across all sessions.

Content reads accept an opaque session-owned identifier, not a path or external
URL. `offset` / `maxBytes` refer to raw bytes before base64 encoding; `nextOffset`
equals `offset` plus returned byte count and `eof` means total length reached.
Chunks can split UTF-8 characters; the client uses an incremental decoder and
verifies the whole-content digest before treating the value as complete. Reading
an old unavailable revision returns `REVISION_EXPIRED`; never substitute new bytes
at an old offset. Artifacts use this same content API; no second download authority
or unencrypted HTTP path is introduced.

Approval requires the complete current tool input, not a short preview. The UI
fetches any referenced input, verifies its digest, and displays the actual request
before submitting a decision. Event notifications contain summaries; every enabled
Agent device may explicitly fetch complete details for the relevant interaction.
Content IDs still must resolve to that session and revision. The desktop checks the
pending interaction, input digest,
revision and execution atomically; another decision or changed input returns
`CONFLICT` with an authorized current-state reference. Disconnect/timeout never
means approve. Cancellation compares the exact execution ID under the same owner
serialization and cannot cancel a replacement execution.

## Incremental event API

`agent.events` is the sole ordered session-delivery notification:

```json
{
  "jsonrpc": "2.0",
  "method": "agent.events",
  "params": {
    "subscriptionId": "sub-1",
    "sessionId": "session-1",
    "streamEpoch": "epoch-1",
    "events": [
      {
        "seq": "42",
        "kind": "part.append",
        "payload": {
          "messageId": "message-1",
          "partId": "part-1",
          "baseRevision": "6",
          "revision": "7",
          "offsetUtf8": "12",
          "text": "hello"
        }
      }
    ]
  }
}
```

Within an epoch sequences start at `1`, are strictly contiguous, and never change
once published. `0` denotes the initial empty prefix. An epoch names one canonical
session event history for one protocol-version projection, independent of connection or
execution. A new execution does not reset it. Desktop restart, journal loss, or
incompatible projection reset creates a new epoch. Different protocol-version projections
never reuse the same epoch for different payloads. Shared canonical events carry
bounded interaction summaries; full approval input
is available through explicit detail/content reads to enabled devices. Devices must
not receive different payloads at the same `(sessionId, epoch, seq)`.

| Event kind | Payload and reducer effect |
|---|---|
| `session.updated` | Complete session metadata/status, including `idleRevision` when idle; does not include transcript |
| `execution.updated` | Complete `Execution` state; preserves stable execution identity |
| `message.created` | New message metadata with empty ordered part IDs |
| `message.updated` | Message metadata replacement with `baseRevision`, `revision`; no cumulative part text |
| `message.removed` | `messageId`, `baseRevision`, `revision`; tombstones the message and its parts |
| `part.created` | `messageId`, insertion `afterPartId` (null = first), complete initial `Part` |
| `part.append` | `messageId`, `partId`, `baseRevision`, `revision`, `offsetUtf8`, `text`; appends text/reasoning/tool-input text |
| `part.replaced` | `messageId`, `partId`, `baseRevision`, complete next-revision `Part`; explicit correction or new immutable content reference |
| `part.completed` | `messageId`, `partId`, `baseRevision`, `revision`, final byte length/digest and kind-specific terminal state |
| `part.removed` | `messageId`, `partId`, `baseRevision`, `revision`; removes and tombstones that part |
| `interaction.updated` | `interactionId`, `revision`, `executionId`, status and safe summary; clients explicitly retrieve complete details |
| `history.committed` | `historyRevision`, affected message IDs/revisions, execution ID if applicable; marks durable persistence and invalidates older cached history |

A part revision advances on creation/update, with an exact previous revision
precondition thereafter. Message revisions track metadata and ordered membership;
part creation/removal also carry the message's base/next revision. Message metadata
updates cannot reorder parts implicitly. Creation requires absence; tombstoned IDs
are not reused. An append's byte offset equals the current UTF-8 byte length and
its text contains complete Unicode scalar values. Batch only adjacent compatible
appends before assigning sequences/revisions; published journal entries are
immutable. Completion asserts digest/length rather than resending accumulated text.
Tool-input completion establishes the complete parsed input (inline or reference);
tool output/status/replacements use explicit part variants, covering non-text output.

The client reducer validates the next sequence, identities, revisions, offsets,
terminal lengths and digests. Duplicate sequences at/below an already applied
cursor do not apply twice; a gap or conflicting transition stops application and
requests recovery. Never advance a cursor past a failed event.

### v1 live/history boundary

Desktop is the sole authority; Mobile submits commands and maintains a read
projection, not an independently editable replica. Message/part deltas cover the
current execution. Retain its complete live baseline through finalizing; only after
durable `history.committed` and the execution's terminal event may its overlay be
discarded and the messages read as history. Keeping completed content in a UI cache
does not make it a live delta target again.

Changes to completed history publish `history.committed` with the new history
revision and affected IDs, invalidating cached history for on-demand rereading.
They do not emit message/part deltas against that historical content. Scrolling or
reloading history never emits `message.created`; creation means a genuinely new
identity. v1 does not support an archived message re-entering live deltas in place,
unconditional upserts, or fetching an old message version to fill a missing append
base. If an owner transition requires rebuilding the live projection, reset the
subscription and establish an authoritative checkpoint before further deltas.

Replay requires both a complete local live baseline and a contiguous retained
suffix. If either is missing, stop applying/ACKing new events, close the old
subscription and subscribe without a cursor to obtain a checkpoint. Do not patch
individual messages or merge divergent client state. This deliberately favors
incremental delivery and short-disconnection replay on the common path, accepting
the cost of a checkpoint for exceptional recovery. Existing bounded content reads
for checkpoints, new live parts and tool outputs remain unchanged; they are not a
historical-version repair mechanism.

`execution.updated` distinguishes `running`, `awaiting-approval`, `finalizing`, and
terminal `completed` / `cancelled` / `failed` / `interrupted` states. Provider EOF
means `finalizing`, not durable completion. A terminal success/cancellation is
published only after final message persistence and `history.committed`; a failed
persistence path reports failure with durability explicitly unavailable. No client
infers successful execution from a command receipt or transport ACK. Desktop crash
can lose unpersisted output; after epoch reset return stored history and an honest
interrupted state rather than replaying the execution to recreate text.

## Subscriptions, checkpoints, and recovery

| Method | Params | Result |
|---|---|---|
| `agent.sessions.subscribe` | `{ sessionId, cursor?: AgentCursor }` | `{ subscriptionId, mode: 'replay', fromCursor, highWatermark, leaseExpiresAt }` or `{ subscriptionId, mode: 'checkpoint', reason, checkpoint }` |
| `agent.checkpoints.read` | `{ subscriptionId, checkpointId, pageCursor?: string }` | `{ checkpointId, pageIndex, items, nextCursor, pageDigest }` |
| `agent.subscriptions.activate` | `{ subscriptionId, appliedCursor: AgentCursor }` | `{ subscriptionId, status: 'active' }` |
| `agent.subscriptions.ack` | `{ subscriptionId, cursor: AgentCursor }` | `{ acknowledged: AgentCursor }` |
| `agent.subscriptions.close` | `{ subscriptionId }` | `{ closed: true }` |

These operations require enabled device authorization, not individual permissions;
they are transport operations, not business mutations, and do
not use `commandId`. IDs are connection-local and cannot be used by another device.
At most one pending/active subscription per session per connection; a second
subscribe returns `CONFLICT` until the first is closed. Lost subscribe/activate
responses are recovered by reconnecting from the last atomically stored cursor.
ACK is cumulative and safe to repeat; close is idempotent on its owning connection.

The remote adapter first establishes a complete projection from the execution
owner's existing listener/replay and state notifications. It must verify a gap-free
handoff; incomplete buffer replay is not a valid baseline. The remote journal then
serializes checkpoint capture with publication of its protocol events. This is a
consistency requirement, not a mandate for a new execution-owner capture API:

1. **Prepare:** for a usable cursor, reserve the complete suffix through current
   watermark H and delivery of subsequent events. Return `mode: replay`; do not
   emit events before activation. No cursor, different epoch, cursor ahead of H,
   or an evicted suffix returns `mode: checkpoint` with an explicit reason.
2. **Checkpoint:** atomically capture the authorized session projection at C and
   reserve journal events after C. Descriptor fields are `checkpointId`, `cursor`,
   `historyRevision`, `pageCount`, `byteLength`, `sha256`, `expiresAt`. Pages contain
   typed session/execution/message/part/interaction-summary items, enough to restore
   the live overlay and pending-interaction summaries, not the entire old transcript.
   Chunk large values or use immutable content references; never truncate them.
3. **Install:** pull one page at a time into staging and fetch referenced baselines
   of appendable live parts. Validate page/content digests and item references,
   then atomically install the complete projection and cursor C locally.
   `sha256` covers canonical UTF-8 page bytes in page-index order;
   the package owns that canonical encoding. An expired/missing page invalidates
   the entire staged checkpoint. Pin any referenced live-content revision for the
   checkpoint lease; fail explicitly if that budget cannot be reserved.
4. **Activate:** supply exactly the prepared replay `fromCursor` or installed
   checkpoint cursor C. The server verifies the reservation is still intact,
   serializes the success response before any events, then sends the contiguous
   suffix and joins live delivery. No snapshot-to-subscription gap is permitted.
5. **Apply/ACK:** apply each contiguous batch; persist the resulting projection and
   cursor in one local transaction before ACK. The server releases delivery credit
   through that cursor. An ACK certifies a recoverable client projection, not that
   the Agent's output is durable on the desktop.

Journal and checkpoint reservations are bounded and expiring, never unbounded
pins. If output outruns a prepared or active subscriber, invalidate that reservation
and send `agent.subscriptions.resetRequired` with `{ subscriptionId, reason }`.
Stop its events and release resources; the client closes that subscription and
prepares again. Activation then returns `RESET_REQUIRED`, never succeeds against
a partially retained suffix. If a reset notification itself cannot be delivered,
close the connection. Checkpoint/replay reservation expiry is measured from prepare;
reading pages or sending ACKs does not extend it indefinitely.

An active subscriber's lease covers preparation only; after activation, replay
retention and credit limits apply continuously. Checkpoint resources are released
on activation/close/expiry; the installed baseline must include locally retained
bytes or stable durable references, so releasing the lease does not strand live
content. Clients may discard cached old history when its revision expires.

On reconnect the client sends its stored `(sessionId, streamEpoch, seq)`, never
just its last received event number. If projection/cursor durability cannot be
provided, discard both after client restart and request a checkpoint. A desktop
restart changes epoch; bounded replay is not a persistent event-sourcing promise.
History reads can proceed independently at the checkpoint's `historyRevision`;
if that revision is gone, restart that history traversal at a fresh revision without
rolling back a newer live overlay.

## Command admission and response loss

```ts
type CommandReceipt = {
  commandId: string
  method: string
  status: 'accepted' | 'applied' | 'rejected' | 'interrupted'
  admittedAt: string
  sessionId?: string
  executionId?: string
  result?: unknown
  error?: RemoteFailure
}
```

Receipt `result` is JSON with operation-specific contents: session creation
returns its session ID, send its admitted message/execution IDs, cancel its target
execution ID and disposition, and approval its canonical interaction decision.
`accepted` means durable command intake, `applied` means the owning operation
was applied, not that an Agent run completed. The intake/reservation distinction is
described below. A terminal rejection carries a stable error. `interrupted` means the desktop cannot safely establish whether an external
side effect finished and will not automatically rerun it.

The client persists a random `commandId` and exact method/body before sending.
The server keys receipts by device ID + authorization-generation ID (`grantId`) +
command ID and stores a canonical body identity excluding transport `id` and business `commandId`. Method name
and every execution/precondition field are included. Same ID and same body returns
the existing receipt; changed body returns `IDEMPOTENCY_CONFLICT`.

Session creation commits the created session and terminal receipt in one SQLite transaction.
A send first records a durable deduplication receipt, then validates under the owning
session dispatch lock. The owner's message-reservation transaction commits the user and
assistant rows together with the receipt's `executionId` and result `{ executionId,
messageId, userMessageId }`, before runtime activation. A rolled-back reservation leaves
neither messages nor result identities. An `accepted` intake alone does not prove that
work was reserved or activated.

Authentication and current authorization are checked even on duplicates. Precondition
failures settle as terminal receipts. On restart, outstanding receipts become `interrupted`
and retain any committed reservation identities; clients can reconcile the persisted messages.
Cancel and approval can cross runtime/external boundaries and cannot be committed in a
SQLite transaction. Uncertain outcomes are not automatically replayed. This implementation
does not promise automatic resumption of unactivated work or exactly-once external effects.

After a timeout, call `agent.commands.get` or retry the same ID/body. `NOT_FOUND`
is not a reason to mint another ID: retry the original ID, since admission might
still race with the query. Rich receipts may be compacted, but retain sufficient
command identity and terminal disposition as tombstones for the lifetime of the
authorization generation/device. New-command admission is rate/space limited;
storage pressure must not silently expire deduplication and make old actions
executable again. Restore revokes device credentials/Agent authorizations before
accepting traffic against rolled-back receipts.

This provides at-most-once command admission within its authority lifetime, not
exactly-once third-party tool side effects. Control commands share existing execution
serialization with the desktop UI. A disconnected phone does not own the run and
does not cancel it. No subscription is required to keep admitted work running.

## Limits, flow control, and errors

Proposed initial budgets, returned by `connection.hello` and subject to measured
mobile acceptance before release:

| Resource | Initial ceiling |
|---|---|
| Plaintext application record / event batch | 64 KiB / 16 KiB |
| Content read | 24 KiB raw per response (base64 and envelope must fit record) |
| Collection page / in-flight requests / JSON-RPC batch | 100 items / 16 requests / 16 entries, with record byte ceiling taking precedence |
| Unacknowledged event bytes | 256 KiB per subscription |
| Queued output / subscriptions | 1 MiB per connection / 8 subscriptions |
| Replay retention | 8 MiB or 5 minutes per session; 64 MiB globally, whichever limit is reached first |
| Checkpoint preparation | 5-minute lease, one per session/connection; 32 MiB global pinned bytes including live referenced content |
| Heartbeat / idle timeout | ping every 20 seconds; close after 60 seconds without authenticated peer traffic |
| Pair invitation / access token | 2 minutes / 10 minutes; 30-second expired-token refresh grace |

Credit counts canonical UTF-8 event-entry bytes before encryption; retransmission
on a new subscription starts a new accounting window. A valid cumulative ACK must
match session/epoch, be monotonic, and be no higher than the greatest sequence sent
on that subscription. Ignore an equal ACK, reject an ahead/wrong-epoch ACK without
releasing bytes. ACKed journal entries may remain within shared retention for later
reconnect; ACK is a delivery-credit operation, not an unconditional journal delete.

Coalesce adjacent append content up to a small latency budget and batch byte limit
before assigning sequences. Never suppress final content or rewrite retained events.
Send bulk history/content only in bounded requested pages. A single slow consumer
must neither stall Agent execution nor allocate an unbounded private queue. When
credit is exhausted, stop event delivery to that subscriber and rely on the bounded
journal; reset it if its suffix is evicted. Global pressure can force recovery,
but does not cancel execution or block healthy subscribers.

Reserve request-processing and unsent-output capacity for ACK/auth/ping/cancel /
approval; do not put ACK behind the same low-rate mutation quota. Authenticate and
rate-limit handshakes, pairing attempts, new commands and content reads separately.
Prioritize control over unsent bulk pages, while recognizing that already-written
WebSocket/TCP bytes cannot be overtaken. Record size bounds limit that delay; do
not promise strict control latency over a blocked socket.

| Application reason (`error.data.reason`, code `1000`) | Meaning / recovery |
|---|---|
| `INVALID_CONNECTION_STATE` | Complete hello/authentication before domain calls |
| `UPGRADE_REQUIRED` | No common protocol version; install compatible releases, no partial-contract fallback |
| `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `GRANT_REVOKED` | Authenticate/refresh or require new desktop approval |
| `FORBIDDEN`, `NOT_FOUND` | Operation outside the remote API boundary, or resource/handle unavailable; no per-action permission tiers |
| `CONFLICT`, `IDEMPOTENCY_CONFLICT` | Refresh authoritative state; do not alter an existing command's body |
| `RESET_REQUIRED`, `CHECKPOINT_EXPIRED`, `REVISION_EXPIRED` | Restart the corresponding subscription/checkpoint/read traversal |
| `RATE_LIMITED`, `RESOURCE_EXHAUSTED` | Respect `retryAfterMs`; retain the original command ID |

Standard `-32700` / `-32600` / `-32601` / `-32602` failures require corrected input;
`-32603` does not prove a mutation was never admitted, so query/retry its original
command ID. A stored failure with reason `INTERNAL` likewise exposes no raw exception.
Errors are safe public codes/messages with schema-defined details, never raw
exception text, paths, tokens, or provider secrets. The app localizes codes; it does
not parse error prose. Invalid authenticated JSON receives the standard JSON-RPC
error when safe to return; repeated malformed input is rate-limited and may close
the channel. Invalid/oversized ciphertext closes without an RPC reply.
Reconnect uses exponential backoff with jitter and a cap; auth rejection and
version mismatch require corrective action rather than an infinite retry loop.

## Public package API

Proposed named exports; these are implementation targets, not existing imports:

| Export path | Public API |
|---|---|
| `@cherrystudio/remote-protocol` | `jsonRpcRequestSchema`, `jsonRpcResponseSchema`, `jsonRpcNotificationSchema`, `jsonRpcErrorSchema`, `remoteFailureSchema`, `connectionMethods`, `pairingMethods`, `connectionNotificationSchema`, `JsonRpcRequest`, `JsonRpcResponse`, `JsonRpcNotification`, `JsonRpcError`, `RemoteFailure`, `IntegrityPrimitives`, `negotiateProtocol` |
| `@cherrystudio/remote-protocol/agent` | `agentMethods`, `agentNotificationSchema`, `agentEventSchema`, `agentAuthorizationSchema`, `agentCheckpointPageSchema`, `AgentAuthorization`, `AgentMethod`, `AgentMutation`, `AgentParams`, `AgentResult`, `AgentEvent`, `AgentEventBatch`, `AgentCursor`, `AgentProjection`, `AgentCheckpointDescriptor`, `AgentCheckpointPage`, `MaterializedContent`, `ApplyAgentEventsResult`, `InstallAgentCheckpointResult`, `applyAgentEvents`, `installAgentCheckpoint`, `encodeAgentCommand`, `encodeAgentCheckpointPage` |

`connectionMethods` and `pairingMethods` are schema factories accepting a domain
authorization validator: authentication/refresh and approved pairing results compose
that validator into common shapes; claims request a domain, not a permission policy.
The root must not import `AgentAuthorization`. v1 authorizes Agent access as one
device switch; a future domain needs an explicit authorization design of its own.

`agentMethods` maps every method name to `{ params, result, errors }` runtime
schemas. `AgentParams<M>` / `AgentResult<M>` are inferred from that map. A consumer
may wrap its own transport in the following typed signature:

```ts
type AgentRequest = <M extends AgentMethod>(
  method: M,
  params: AgentParams<M>
) => Promise<AgentResult<M>>
```

This signature describes type checking, not a bundled network client. Connection
lifecycle, durable local transactions, key storage and retries stay with each app.
No SDK/reconnect framework or crypto implementation is added merely to share types.

Proposed pure function contracts:

```ts
applyAgentEvents(projection, batch, materializedContent, integrity)
// -> { ok: true, projection, cursor }
//  | { ok: false, reason: 'gap' | 'epoch' | 'revision' | 'content' }

installAgentCheckpoint(descriptor, pages, materializedContent, integrity)
// -> { ok: true, projection, cursor }
//  | { ok: false, reason: 'incomplete' | 'digest' | 'invalid' }

encodeAgentCommand(method, params)
// -> Uint8Array: canonical identity bytes, excluding commandId

encodeAgentCheckpointPage(page)
// -> Uint8Array: canonical page body bytes, excluding pageDigest

negotiateProtocol(local, remote)
// -> { protocolVersion } from the supported-version intersection, or incompatibility
```

`materializedContent` is a caller-supplied map of verified revision-pinned bytes
needed for live append baselines; the reducer never fetches it. Missing required
content returns failure before advancing the cursor. Lazy durable history and
non-appendable file references need not be downloaded to install a checkpoint.
`integrity: IntegrityPrimitives` supplies a deterministic synchronous
`sha256(bytes: Uint8Array): string` from a verified implementation in the consumer;
the package validates digests without bundling a crypto implementation or Node API.
Reducers have no side effects and do not partially mutate their input on failure;
the caller commits the returned projection/cursor atomically. Checkpoint install
validates page order, aggregate length/digest and item relationships before returning
state. Canonical encoding uses [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785):
preserve array order and exact string content, reject invalid JSON/Unicode, and
apply no Unicode normalization. Use an existing conformant portable implementation,
not a new sorting/hashing convention. Command identity encodes `{ method, params }`
after removing `commandId`, preserving absent versus null and without inserting
schema defaults. The versioned schemas bound every field before encoding.
Runtime authentication/admission and digest verification use the
same package fixtures and the selected portable cryptographic primitive; validators
alone do not replace authorization.

Publish conformance cases for Unicode append offsets, tool variants, concurrent
parts, replacements, duplicate/gapped events, checkpoint installation, and canonical
command identity. Assert reconstruction against an independent expected transcript,
not just the reducer's own output. Install the packed artifact in desktop Node and
Expo/Metro and test every advertised version pair. The package lifecycle and
boundary rules are defined in the [architecture proposal](../api-gateway/remote-agent-access.md#public-protocol-package).

## Example: interrupted send and reconnect

```text
phone persists { commandId: c1, sessionId: s1, text, expectedIdleRevision: r7 }
phone → agent.messages.send (JSON-RPC id q1, commandId c1)
desktop records c1, then atomically persists its message reservation and execution e1 linkage
connection drops before the receipt reaches the phone

phone reconnects, negotiates, authenticates the same device/authorization generation
phone → agent.commands.get (commandId c1)
desktop → existing receipt for e1 (or NOT_FOUND: retry the same c1/body)
phone → agent.sessions.subscribe (stored epoch/seq, if any)
desktop → replay preparation OR checkpoint descriptor
phone installs checkpoint if needed, then activates with the prepared cursor
desktop → activation response, contiguous replay, then live events
phone commits projection + cursor, then ACKs
```

A different JSON-RPC `id` is normal; a different `commandId` would be a new action.
If desktop state was lost, epoch reset recovers persisted history and honest
execution status, not a second run. For rollout order and adversarial acceptance
cases see [Implementation order and acceptance](../api-gateway/remote-agent-access.md#implementation-order-and-acceptance).
