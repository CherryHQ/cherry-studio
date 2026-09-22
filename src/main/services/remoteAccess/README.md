# Remote access

LAN-only remote access over the API Gateway's existing HTTP listener. The lifecycle
service owns encrypted WebSocket connections, pairing invitations and delivery.
Agent and configuration capabilities share identity and transport, and are approved
together during pairing. Each capability has an independent authorization grant.

| File | Owns |
|---|---|
| `RemoteAccessService.ts` | Accepts sockets from the gateway's `/v1/remote/connect` ws route, identity, sweep, connection registry |
| `RemoteConnection.ts` | Per-connection RPC: hello/authenticate/refresh/ping, pairing, configuration export |
| `RemotePairing.ts` / `RemoteTokens.ts` / `deviceIdentity.ts` | Invitation + claim state, access tokens, Ed25519 identity file |
| `agentHandlers.ts` | Every `agent.*` method, including durable command receipts |
| `agentQueries.ts` | Persisted sessions/messages/parts/interactions projected onto wire DTOs |
| `agentJournal.ts` | Shared per-session journal: stream listener → protocol events, checkpoints, epoch |
| `agentSubscriptions.ts` | Connection-private subscriptions: prepare, activate, ack credit, reset |

Deviations from the design doc, kept deliberately small:

- Command receipts (`remote_command`) are recorded as `accepted` before the owner runs and
  settled afterwards; they are not in the same transaction as the owner's reservation.
  Receipts still `accepted` at startup become `interrupted`.
- Locally started executions are discovered by a one-second poll of `hasLiveStream`, then
  attached through `addListener` replay. Remote sends pass the listener at run start.
- Approval cards persisted after a turn ended are listed and answerable, but not streamed as
  `interaction.updated`; only stream-presented approvals enter the live projection.
- Files are exposed as `data` parts with metadata only.

SQLite writes stay in their owning data services. Agent execution stays in the
existing stream manager and runtime. No relay service is provided here.
