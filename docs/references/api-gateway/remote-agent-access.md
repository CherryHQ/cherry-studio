# Remote Agent Access (Design)

> **Status: design proposal — not yet implemented.**
> [`README.md`](./README.md) documents the **as-built** API Gateway (OpenAI/Anthropic
> compatibility for local SDK clients). This document specifies a **proposed
> extension**: reaching a *running agent session* from a user's own mobile client,
> over a transport that works self-hosted and cloud-hosted from one substrate.
> Symbols marked **(exists)** are present today and reused as-is; everything else
> is new and described in the future tense.

## Goal

Let a user open their own mobile app and **see and drive an agent session that is
running on their desktop** — read the live transcript, send prompts, and approve
tool calls — without learning VPN/tunnel/networking concepts.

The agent keeps running **in the Electron desktop** (main process); the cloud is
**relay only** (it forwards bytes, it does not execute agents). The same relay
codebase runs as the user's self-hosted instance or as our managed service.

## Scope & locked decisions

- **Target is the agent**, not the gateway's OpenAI/Anthropic chat endpoints.
- **Own mobile client** (Expo / React Native). Mobile rendering is **out of scope
  here**; the hand-off boundary is the wire contract (`@shared/ai/transport`).
- **Cloud = relay only.** The agent runs in the Electron desktop backend, so
  **the desktop must be online**; when it is not, the mobile client shows
  "cannot connect". There is no architectural fallback (a "keep-awake" desktop
  option already exists).
- **Self-hostable.** The relay is one Go codebase; our cloud is a managed instance
  of it.
- **Remote tool approval is supported** — and is the highest-stakes capability
  (see [Security model](#security-model)).
- **Application-layer end-to-end encryption is in scope** — agent content is
  encrypted between the mobile client and the desktop so that no relay/tunnel can
  read or tamper with it. See [End-to-end encryption](#end-to-end-encryption-application-layer).
- **Non-goals (v1):** arbitrary TCP/UDP/RDP/VNC, full VPN, P2P, multi-user
  collaboration, hiding traffic **metadata** from the relay (E2E protects content
  and integrity, not which-desktop/when/how-big).

## Architecture

Two layers. The upper layer never forks; the lower layer is pluggable.

```
Expo / RN mobile client
        │  WSS  (speaks @shared/ai/transport)
        ▼
  Reachability provider  ──►  { baseUrl, sessionToken, scope }
        │
   ┌────┴───────────────────────────────────────────────┐
   │ ① direct / BYO-URL (no relay)                       │
   │     LAN · Tailscale/WireGuard/ZeroTier · cloudflared │
   │ ② relay (reverse tunnel) — one Go codebase           │
   │     hosted (+ Passport)  ·  self-host (+ deploy token)│
   └────┬───────────────────────────────────────────────┘
        ▼
  Desktop apiGateway  ── agent transport surface (WS) ──►  AiStreamManager
        │                                                    (exists)
        ▼
  Headless agent loop in main process  (exists: startAgentSessionRun)
```

- **Invariant — the agent transport surface (Stage 1).** A WebSocket surface on
  the existing `apiGateway` that carries the **already-existing**
  `@shared/ai/transport` protocol. Every reachability mode hits the *same* WS
  server (`ws://desktop/v1/agent/...`); only how the mobile becomes able to reach
  it differs.
- **Seam.** A reachability provider exposes only `{ baseUrl, sessionToken, scope }`
  to the rest of the system. Tailscale concepts (tailnet/ACL) and Passport
  concepts (account) never leak past it.

## Reuse map

The agent's I/O machinery already exists; the work is an HTTP/WS edge plus a relay.

| Capability | Status | Symbol |
|---|---|---|
| Drive a turn | **exists** | `AiStreamOpenRequest` (submit / regenerate) |
| Attach + replay | **exists** | `AiStreamAttachRequest` → `AiStreamAttachResponse` (`bufferedChunks` / terminal `finalMessages`) |
| Live chunk / done / error | **exists** | `StreamChunkPayload` / `StreamDonePayload` / `StreamErrorPayload` |
| Tool approval | **exists** | `AiToolApprovalRespondRequest` / `ApprovalDecision` |
| Abort | **exists** | `AiStreamAbortRequest` |
| Topic status (incl. awaiting-approval) | **exists** | `TopicStreamStatus` |
| Non-renderer HTTP listener | **exists** | `SseListener` (an equal `AiStreamManager` subscriber) |
| Fan-out + buffer + grace + background-continue | **exists** | `AiStreamManager` (`maxBufferChunks`, grace period, `backgroundMode:'continue'`) |
| Open / attach / abort / approve logic | **exists** | `ai.*` IPC handlers (`src/main/ipc/handlers/ai.ts`) |
| Headless agent execution | **exists** | `startAgentSessionRun()` |
| Tool-approval join point | **exists** | `ToolApprovalRegistry` + `AiService.respondToolApproval()` |
| Session list / history | **exists** | DataApi `/agent-sessions`, `/agent-sessions/:id/messages` (`src/main/data/api/handlers/agentSessions.ts`) |
| HTTP server | **exists** | `apiGateway` (Elysia + `@elysia/node`, `127.0.0.1:23333`) |
| **WS agent surface** | **new** | `WebSocketListener` + `/v1/agent/*` routes |
| **QR pairing + capability token** | **new** | `/v1/pair/*` routes + token mint/verify |
| **Relay (reverse tunnel)** | **new** | separate Go project (`frps`/`frpc`-style) |

`AiStreamManager.dispatch(listener, openRequest)` is **already listener-generic**
(the IPC handler just happens to pass a `WebContentsListener`); a `WebSocketListener`
slots into the same call. `attach(wc, req)` is currently `WebContents`-typed and
needs a `StreamListener`-typed variant — the one required refactor.

## Reachability modes

### ① Direct / BYO public URL (no relay)

The mobile reaches the desktop's `apiGateway` at *some* URL the user controls:
LAN, a mesh VPN (Tailscale / WireGuard / ZeroTier), or a BYO tunnel
(cloudflared / ngrok / the user's own reverse proxy). The code only needs to
support **an arbitrary `baseUrl` + a desktop-self-signed capability token** — which
is required for Tailscale anyway, so cloudflared etc. fall out for free. Pairing
and the token are handled locally: the **desktop is its own control plane** (it
runs the pairing endpoints and self-signs the token). The relay control protocol
is not used.

> **cloudflared / BYO tunnel — content is protected by app-layer E2E; metadata is
> not.** Such tunnels terminate TLS at a third-party edge, but
> [application-layer E2E](#end-to-end-encryption-application-layer) means that edge
> (and our own relay) sees only **ciphertext plus routing metadata** — it cannot
> read or tamper with agent content or tool-approval messages. It *does* see
> metadata (which desktop/session, timing, sizes). A one-click cloudflared launcher
> (binary via `BinaryManager` + a quick tunnel) is a reasonable demo affordance,
> additive to — not a replacement for — our relay on the hosted path. A mesh
> (Tailscale/WireGuard) encrypts the transport end-to-end too, so there E2E is
> defense-in-depth.

### ② Relay (reverse tunnel)

For users with no shared network. One Go codebase, two operators:

- **Hosted** — we operate it; identity via **Passport** (the cloud account).
- **Self-host** — the user runs it (`docker compose up`); identity via a
  **deploy token**.

See [Control-layer contract](#control-layer-contract).

## Exposed endpoints (agent transport surface)

New routes on `apiGateway`. **Two auth domains on one server:** the existing
OpenAI/Anthropic routes keep the global `cs-sk` key; the new `/v1/agent/*` and
`/v1/pair/*` routes use the **capability token** (a JWT), whose `cap` bits and
`session_id` binding the **desktop** verifies.

> **With E2E on (default for the relay/cloudflared modes):** the capability token
> is presented as the **first message inside the E2E channel** (§
> [End-to-end encryption](#end-to-end-encryption-application-layer)), never in a
> URL/header the relay can read. The WS upgrade itself carries only a **coarse
> relay-session credential** used for routing. The `@elysia/bearer` header/query
> form is used only in direct (no-relay) modes where there is no third party to
> hide the token from.

### A. Live channel (WebSocket — the core)

`GET /v1/agent/sessions/:sessionId/stream` (WS upgrade, `?access_token=…`).
One socket carries everything. Envelope is `{ type, payload }` where **`payload`
reuses `@shared/ai/transport` types verbatim**:

| Dir | `type` | `payload` | Maps to | cap |
|---|---|---|---|---|
| on connect | `attach` | `AiStreamAttachResponse` | `AiStreamManager.attach` (generalized) | view |
| ↓ | `chunk` / `done` / `error` | `StreamChunkPayload` / `StreamDonePayload` / `StreamErrorPayload` | `WebSocketListener` | view |
| ↑ send prompt | `open` | `AiStreamOpenRequest` | `dispatch(wsListener, req)` | send |
| ↑ stop | `abort` | `AiStreamAbortRequest` | `abort(topicId)` | send |
| ↑ approve tool | `approve` | `AiToolApprovalRespondRequest` | `respondToolApproval(payload, wsListener)` | **approve** |
| ↕ heartbeat | `ping` / `pong` | — | app-level (required on mobile networks) | — |

Connecting *is* attach; closing *is* detach. The first server frame replays
buffered/terminal state, then live chunks flow.

### B. Agent data (REST — reuse the data layer)

| Endpoint | cap |
|---|---|
| `GET /v1/agent/sessions/:sessionId` | view |
| `GET /v1/agent/sessions/:sessionId/messages?before=&limit=` | view |

### C. QR device pairing (REST)

See [QR device pairing](#qr-device-pairing) for the flow and why this is **not**
RFC 8628 (only its safety mechanics are borrowed).

| Endpoint | Caller | Purpose |
|---|---|---|
| `POST /v1/pair/sessions` | desktop (local) | start pairing → `pairing_code` + QR (`verification_uri_complete`) + `confirm_code` + TTL |
| `POST /v1/pair/sessions/:code/claim` | phone | submit device info → `confirm_code` (matched on both screens) + requested scope |
| `POST /v1/pair/sessions/:code/approve` | desktop (local, authed) | user grants scope (view/send/approve) |
| `POST /v1/pair/sessions/:code/token` | phone (poll) | once approved → **capability token + baseUrl** |

### D. Sharing control (REST — visible state + kill switch)

| Endpoint | Purpose |
|---|---|
| `GET /v1/agent/shares` | active phones / sessions / caps / duration |
| `DELETE /v1/agent/shares/:id` | revoke a share |

### Access control — no app-level guard, no separate listener

The new routes **co-locate** on `apiGateway`. "Who may reach the endpoint" is
delegated to the layer that owns reachability:

- **direct / Tailscale** → the **tailnet ACL** (the boundary the user chose; the
  app does not add its own guard, and the powerful `cs-sk` routes being reachable
  on a trusted tailnet is acceptable — they still require the key).
- **hosted relay** → the relay **forwards only `/v1/agent/*` + `/v1/pair/*`** by
  construction, so the `cs-sk` surface never leaves.
- **BYO tunnel** → the user scopes their own tunnel (documented, not enforced).

## Control-layer contract

Relevant only to reachability mode ②. **Three independent protocol surfaces;** the
relay implements surfaces 1–2 and treats surface 3 as opaque payload. Modeled on
**frp** (Go, the direct analogue), cross-checked against ngrok/cloudflared.

```
mobile WSS → relay (Go) → [yamux over TLS] → desktop tunnel client (Go) → localhost apiGateway WS
```

Because the desktop tunnel client is **also Go and ships in the same project**
(`frps`/`frpc` model), surface 1 is **Go↔Go** and needs no cross-language schema.
The Electron app only spawns the client binary (acquired via `BinaryManager`) with
a few flags (`relay URL`, `token`, local port).

### Surface 1 — tunnel control (desktop ↔ relay)

- **Connection model.** Desktop dials **one** outbound TLS connection, multiplexed
  with **yamux**. The **relay opens a stream to the desktop** per incoming mobile
  connection (ngrok/yamux model — simpler than frp's `ReqWorkConn` dial-back); the
  desktop client pipes it to the local `apiGateway` WS.
- **No `NewProxy`.** There is exactly one target (the apiGateway WS); the desktop
  registers itself and every stream maps to that one endpoint.
- **Control stream.** One dedicated yamux stream carries JSON control messages
  (frp-v1 framing: `1 type byte | 8-byte BE length | JSON`, or newline-delimited
  JSON). Minimal set: `Register`/`RegisterResp` (carries tunnel-auth token +
  `desktop_device_id` + `resume_id`; relay returns the assigned UUID),
  `OpenSession` (relay→desktop: new mobile stream header `session_id`, then raw
  pipe), `CloseSession`, `Ping`/`Pong`.
- **Tunnel auth.** `HMAC-SHA256(token, timestamp)` + constant-time compare +
  freshness window. This authenticates the **tunnel identity** and is distinct
  from the capability token (surface 3).
- **Routing.** Per-desktop **UUID** (cloudflared model); mobile addresses
  `wss://relay/<desktop-uuid>`. Hosted: a UUID is routable only within its owning
  Passport account (multi-tenant isolation); self-host collapses to one account.
- **Reconnect.** frp's **RunID** resumption — desktop persists `resume_id`, the
  relay atomically replaces the stale session, routing stays stable.
- **Heartbeat.** yamux keepalive suffices on this leg (frp disables app-ping when
  muxed).
- **WebSocket.** yamux streams are raw byte streams, so the mobile's WS upgrade
  passes through to `apiGateway` for a normal handshake — **avoiding cloudflared's
  HTTP/2 `101` rewrite** (ngrok model).

### Surface 2 — QR pairing (relay brokers)

The relay/control-plane serves the pairing endpoints in hosted mode; the desktop's
`apiGateway` serves the same contract in self-host mode. See
[QR device pairing](#qr-device-pairing).

### Surface 3 — capability token (opaque to relay)

See [Capability token](#capability-token). The relay never holds a signing key, so
it can broker but cannot forge or escalate.

## QR device pairing

This is **not** RFC 8628, though it borrows 8628's safety mechanics (one-time
short-lived code, polling, matching-code anti-phishing). It is a **QR device
pairing** flow — the mirror of WhatsApp Web / Discord QR login:

| Role | WhatsApp Web | Here |
|---|---|---|
| displays QR | web (new client) | **desktop (authority + resource)** |
| scans QR | phone (authority) | **phone (new client)** |
| issues credential to | the displayer | **the scanner (phone)** |

Issuing the token to the phone is **not an anti-pattern** — the phone is genuinely
the client that will access the resource. The safety invariant that must hold,
regardless of which side displays vs. scans, is:

> **The authority (the side that owns the resource) explicitly approves before any
> credential is minted; the QR carries only a one-time pairing ticket, never a
> credential.**

Our flow satisfies it: the QR carries a `pairing_code` (a one-time, 60–300 s
ticket), the phone claims, the **desktop user approves** (with a matching code
shown on both screens — anti-phishing), and only then is the token issued. The
genuine anti-patterns — token-in-the-QR (scan = instant access) and
no-authority-confirmation (whoever scans gets in) — are both avoided.

**Hardening (not a v1 blocker).** Delivering the token to the phone via
`/token` has the standard AiTM-theft surface; bind the token to `mobile_device`
and keep the TTL short. Stronger: **proof-of-possession** — the phone generates a
keypair at claim time and the token binds to its public key, so a stolen token is
useless without the phone's private key.

**Pairing also bootstraps E2E.** The same QR + approve flow carries the
*authenticated* key exchange for [end-to-end encryption](#end-to-end-encryption-application-layer):
the phone binds its ephemeral X25519 public key into `/claim` (alongside the PoP
key above), the desktop returns its ephemeral key **signed by the desktop identity
key the phone pinned from the QR**, and the user's `/approve` authenticates the
phone's key out-of-band. This is what stops the relay from MITM-ing the key
exchange — see that section for why an unanchored ECDH through the relay is unsafe.

## Capability token

Short-lived, scoped, **verified offline by the desktop** without trusting the relay.

- **Format.** Asymmetric claims token — **JWT (EdDSA/ES256, `alg` pinned to an
  allow-list)** for ecosystem reach (Go + TS), or **PASETO v4.public (Ed25519)** if
  preferred. **Not** Macaroons (shared-secret breaks relay-free verification);
  **not** default-config JWT (alg-confusion).
- **Claims.** `sub` (user), `desktop_device`, `mobile_device`, `session_id`,
  `cap` (view/send/approve bits), `aud`, `iss`, `iat`, `exp`, `nbf`, `jti`.
- **Who signs.** Hosted → **Passport** signs (relay only transports). Self-host →
  the **desktop self-signs** (it is its own root of trust; the phone learns the
  desktop's public key during pairing).
- **How the desktop verifies (without trusting the relay).** Verify signature
  against an independently-trusted public key (pinned in the build / a Passport
  JWKS endpoint — **never** the relay) → check `exp`/`nbf`/`aud`/`iss` → check the
  `desktop_device`/`session_id` binding matches *this* desktop and session → check
  `cap` bits → (optionally, when online) check `jti` deny-list.
- **TTL & revocation.** Access token 5–15 min, refreshable; pairing ticket
  60–300 s, one-time. Short TTL is the primary revocation; an optional `jti`
  deny-list (entry TTL = token's remaining life) gives surgical revocation when the
  desktop is online.
- **Transport.** Presented to the desktop **inside the E2E channel** (not a
  URL/header), so the relay never reads it; the relay routes on a separate, coarse
  relay-session credential (two tokens — see [End-to-end encryption](#end-to-end-encryption-application-layer)).

## End-to-end encryption (application layer)

Agent content is encrypted **end-to-end between the mobile client and the desktop**,
above the WS transport, so **no relay or tunnel — ours, Cloudflare's, or any
intermediary — can read or tamper with it**, whether or not it terminates TLS. The
relay stays not just agent-agnostic but **content-agnostic**: it forwards opaque
ciphertext. This matters precisely because **remote tool approval** is supported —
with E2E a relay cannot forge or alter an approval, only observe that an encrypted
message passed (or drop it).

- **Cipher suite.** X25519 ECDH → HKDF-SHA256 → an AEAD (XChaCha20-Poly1305, or
  AES-256-GCM if the RN crypto library favours it); per-message nonce + monotonic
  sequence number (replay/reorder protection).
- **Authenticated key exchange — the load-bearing part.** A bare ECDH *through the
  relay* is trivially MITM'd (the relay substitutes its own keys to each side), so
  the exchange MUST be anchored to things the relay cannot forge — the out-of-band
  QR and the desktop identity key:
  - **Desktop side.** The desktop signs its ephemeral X25519 public key with its
    long-term identity key (the same key whose public half the phone pins from the
    QR during pairing). The phone verifies that signature → the desktop's ephemeral
    key is authentic.
  - **Mobile side.** The phone binds its ephemeral public key into the `/claim`
    that proves possession of the one-time QR secret; the desktop user then
    **approves that specific claim** (matching code confirms phone↔desktop). So the
    phone's key is authenticated by *QR-secret possession + human approval*, which
    the relay cannot fabricate.
  - Both derive `K = HKDF(X25519(eph_d, eph_m), transcript)`. The relay holds no
    private key and cannot compute `K`.
- **Where it sits.** A thin wrapper at the WS edge: outbound `@shared/ai/transport`
  payloads are serialized → AEAD-sealed → sent as opaque binary WS frames; inbound
  frames are opened → parsed. **`@shared/ai/transport` is unchanged** (E2E wraps
  it) and **the relay/tunnel needs no change** — it already forwards opaque WS
  frames, now ciphertext.
- **What rides inside the channel.** The live stream, all control
  (`open`/`abort`/`approve`), replayed history, and the capability token (so the
  relay never sees the token).
- **What E2E does NOT hide — metadata.** The relay still sees which desktop UUID /
  session a connection targets and message timing/sizes.
- **Honest limit.** The guarantee is only as strong as the **Expo/RN client's**
  crypto implementation, which is built by a separate team and out of scope here —
  we specify the protocol; a faithful implementation is required. Forward secrecy
  comes from fresh ephemeral keys per pairing + rekey-on-reconnect.
- **Across modes — uniform.** E2E makes the hosted relay and cloudflared/BYO
  tunnels content-private; over a mesh (Tailscale/WireGuard, which already encrypts
  the transport end-to-end) it is defense-in-depth.

## Security model

- **Content is end-to-end encrypted; the relay sees only ciphertext + metadata.**
  See [End-to-end encryption](#end-to-end-encryption-application-layer). A relay
  (ours, Cloudflare's, or any intermediary) **cannot read or tamper** with agent
  content or tool-approval messages. It can still affect **availability** (drop /
  delay traffic) and observe **metadata** (which desktop/session, timing, sizes) —
  it cannot forge.
- **Remote tool approval raises the stakes — defended in depth.** Approving
  remotely = authorizing an action on the user's machine. E2E ensures a relay
  cannot forge/alter an approval; *additionally*: `approve` is a **separate
  capability bit** (a view-only share cannot approve); the desktop **independently
  verifies** the token's scope on every privileged action; the desktop shows what
  is being approved, keeps an audit trail, and retains a kill switch.
- **Scope is enforced at the desktop, not the relay.** The relay is agent- and
  content-agnostic and cannot gate `approve`; the desktop is the authority.
- **Key exchange is the crux of the E2E guarantee.** It must be anchored to the QR
  out-of-band channel + the desktop identity key (above), or the relay can MITM and
  the E2E guarantee is hollow. A mesh (Tailscale/WireGuard) adds transport-level
  E2E as defense-in-depth.
- **Visible state + revoke.** The desktop always surfaces which device is
  connected to which session, for how long, with one-tap disconnect.

## Schema & code generation

**Single IDL = Zod 4** (repo convention); `z.toJSONSchema()` is native (no
`zod-to-json-schema` bridge). `apiGateway` already emits OpenAPI from Zod via
`@elysia/openapi` (`mapJsonSchema: { zod: z.toJSONSchema }`). **Protobuf is not
used** — the control plane is small and low-frequency, the data plane is opaque
bytes, and JSON is debuggable on the wire (frp's control messages are JSON too).

| Surface | Cross-language? | Schema |
|---|---|---|
| Surface 1 (tunnel control) | no (Go↔Go, same project) | internal Go structs |
| Surface 2 (pairing, HTTP) | yes (Go relay / TS apiGateway / Expo) | Zod → **OpenAPI** → Go `oapi-codegen` |
| Surface 3 (token claims) | yes (Go/Passport or TS signs; TS verifies) | Zod → **JSON Schema** → `go-jsonschema`/quicktype |
| Agent surface endpoints | TS serves, Expo consumes (relay opaque) | Zod → OpenAPI |
| TS → Go binary config | a few flags | not a schema |

Upgrade path (YAGNI): if a surface grows large/high-frequency, **TypeSpec** can
emit OpenAPI + JSON Schema + protobuf from one source.

## Build sequence

The first real demo needs **no relay** — it retires the core risk locally.

1. **Agent transport surface (Stage 1)** — add the WS `/v1/agent/*` routes +
   `WebSocketListener`; generalize `AiStreamManager.attach` to a `StreamListener`.
   **Verify with `wscat` on localhost**: attach → replay, `open`, `approve`. Zero
   networking.
2. **Direct demo** — reach Stage 1 over LAN/Tailscale; validate the end-to-end
   product feel (and the Expo client) at near-zero cost. (Trusted transport, so
   E2E is optional here.)
3. **E2E channel** — add the authenticated X25519 handshake (anchored to the QR +
   desktop identity key) and the AEAD payload wrapper. **Required before any
   relay/cloudflared mode is content-private.**
4. **Relay + Passport (hosted)** — the growth path; validates the seam and the
   relay control contract (carrying the now-encrypted payload).
5. **Tailscale self-host** — nearly free once Stage 1 exists.
6. **Relay + deploy token (self-host)** — reuse the relay, swap the auth adapter.

## To confirm during implementation

- `AiStreamManager.attach` gains a `StreamListener`-typed variant (`dispatch` is
  already generic).
- Agent `sessionId` → stream `topicId` mapping (the `open` response's
  `blocked: 'agent-session-workspace'` variant confirms `open` supports agent
  sessions; the key relationship needs checking).
- JWT vs PASETO for the capability token.
- ~~One vs two tokens~~ **resolved by E2E → two tokens**: a coarse relay-session
  credential for routing (relay-visible) + the capability token presented inside
  the E2E channel (relay-opaque).
- E2E cipher suite: X25519 + HKDF-SHA256 + **XChaCha20-Poly1305 vs AES-256-GCM** —
  pick per the RN crypto library's mature primitives.
- Possible simplification: the QR-anchored authenticated handshake already
  authenticates the phone, and `/approve` already carries the granted scope — so
  the desktop *could* record caps against the E2E session instead of minting a
  separate capability JWT. Evaluate after the handshake exists; keep the JWT for
  now (it also serves the direct/no-E2E modes).
- Mobile client native-vs-PWA — **out of scope here**, decided by the mobile team;
  the contract is `@shared/ai/transport` either way.

## Related references

- [API Gateway Reference](./README.md) — the as-built gateway this extends;
  `SseListener`, the two-auth model, Elysia/Zod/OpenAPI wiring.
- [AI Reference](../ai/README.md) — `AiStreamManager`, the `StreamListener` model,
  `@shared/ai/transport`, `ToolApprovalRegistry`, `startAgentSessionRun`.
- [Binary Manager](../binary-manager/README.md) — acquiring the Go tunnel-client
  binary.
- [Lifecycle](../lifecycle/README.md) — `ApiGatewayService`, `Activatable`.
