# Agent remote access

PC LAN access lives here. Start with the [wire protocol and ownership guide](../../../../docs/references/ai/remote-agent-access.md).

- `RemoteAccessService.ts`: lifecycle following Device Connections, backup holds, and resource cleanup.
- `server.ts` / `secureChannel.ts`: WebSocket admission and authenticated encrypted frames; no Electron or business services.
- `identity.ts`: OS-protected desktop encryption identity. Pairing and tokens belong to the existing `ApiGatewayPairedDeviceService`.
- `requestRouter.ts` / `protocol.ts`: bounded request dispatch and method schemas.
- `agentAccess.ts`: the adapter into existing Agent execution and database services — authorization, read queries, and snapshots.
- `agentCommands.ts`: the adapter's writes — session creation, message sends, cancel, and approval — each behind a durable command receipt.
- `RemoteAgentSubscription.ts` / `messageProjection.ts`: coalesced canonical snapshots and bounded mobile projections.
- `messageDetails.ts`: explicit, revision-checked content pages for message and interaction details.
- `artifactAccess.ts`: explicit artifact chunks through existing file APIs, with workspace containment and version checks.

Default synchronization carries text, reasoning, code, artifact markers, and
interaction notifications. Tool input/output and artifact declaration details are
read only on demand. Artifact bytes are returned only for explicit `artifacts.read`
requests, resolved from an authorized message marker rather than a client-supplied path.

Background-task management is outside the mobile contract. Remote access adds no
execution/task metadata to the existing message storage.

Keep all remote authorization at the adapter boundary. AI/data code must not
import this module. Existing services continue to own turns, messages, and tool
decisions. Changing the listening address or port must not rotate desktop identity.
