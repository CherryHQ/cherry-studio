# Remote access

LAN-only remote access over the API Gateway's existing HTTP listener. The lifecycle
service owns encrypted WebSocket connections, pairing invitations and delivery.
Agent and configuration capabilities share identity and transport, and are approved
together during pairing. Each capability has an independent authorization grant.

| File | Owns |
|---|---|
| `RemoteAccessService.ts` | Accepts sockets from the gateway's `/v1/remote/connect` ws route, identity, sweep, connection registry |
| `RemoteAdvertisement.ts` | Publishes the actual Gateway port and public identity while LAN access is enabled; refreshes interface changes and withdraws on shutdown |
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

Execution failures use the shared failure snapshot in both live terminal events and historical
messages. The persistence listener supplies the actual saved message identity and revisions before
the journal declares `durable` or removes the final overlay. Save failures remain separate from
model failures. Terminal events retain the failure and message identity even when history commit
and live-message removal arrive in the same batch; clients can display the result before loading
history. Provider rejection never revokes the device grant or rewrites an applied command receipt.

Question interactions are declared in live events, checkpoints and persisted views. Their form
stays in the input resource. `agent.interactions.respond` validates the revision/execution/digest
and complete answer keys, then forwards original input plus answers (or denial reason) to the
existing Agent runtime. It never accepts caller-supplied replacement tool input.

Workspace catalogs advertise system creation. `agent.sessions.create` resolves explicit system or
registered selections through `AgentSessionService`; the phone cannot supply a directory. Responses
include the actual workspace ID and kind. Legacy mutation forms remain accepted for existing
clients and persisted command recovery. See the [protocol package](../../../../packages/remote-protocol/README.md).

Agent catalogs include the configured emoji, falling back to the desktop's robot avatar when it
is empty or exceeds the wire limit. They never expose desktop avatar file paths.

Known dispatch target validation failures settle commands as rejected with `TARGET_UNAVAILABLE`
and a sanitized diagnostic message. They are distinct from interrupted commands with an unknown
outcome and from model failures after execution admission. Replaying the same command returns the
recorded rejection; it never starts another execution.

`agentUsage.ts` projects host-owned message stats into the portable usage summary. Historical
queries and persisted terminal events read the same materialized row; unsaved terminal messages
retain available final metadata and runtime timing. Overlapping tool/wait spans are unioned before
sending durations. Missing provider data is never estimated from text. This endpoint does not
expose the accounting ledger or claim main-model latency from multi-model aggregates.

Model display metadata follows its owner: Agent catalogs use `AgentService`'s current model/name,
while message history and terminal events use the persisted model identity and matching immutable
snapshot. A changed or removed Agent model never rewrites historical message identity. Unsaved
terminal answers retain final message metadata or the terminal producing model ID.
