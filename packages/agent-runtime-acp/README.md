# ACP v1 runtime

`@cherrystudio/agent-runtime-acp/v1` adapts stable ACP v1 to the [common runtime](../agent-runtime/README.md). The SDK owns protocol framing. The host supplies an exclusive transport lease or a platform spawn operation, native session configuration, credentials, and supported callbacks.

Implementation follows the [ACP Spec](../../.agents/notes/implemented/architecture/2026-11-09-agent-runtime-acp-v1.md). Desktop protocol extensions share the `AcpHarnessAdapter` contract. Each harness with native extensions owns its adapter in an independent `@cherrystudio/agent-runtime-<harness>-acp` package. Ordinary ACP commands use the common adapter.

## Ownership

Desktop chat uses `connectAcpStdio(stdin, stdout, options)` with the host's process join. After `initialize()`, `create` and negotiated `restore` return an `AcpThreadHandle`. Desktop and replay access share native session ownership, opening, controls, prompt dispatch, cancellation and shutdown. The desktop host receives incremental ACP updates. The [OpenClaw adapter](../agent-runtime-openclaw-acp/src/adapter.ts) prefers load on recovery, filters bridge titles and disables the working-directory prompt prefix.

Desktop chat and Settings use `launchAcpStdio` with the resolved command and the host's `SpawnStdio`. The launcher attempts native session close when supported, closes the protocol client and joins the owned process. Main owns desktop resource leases, user approval and the Cherry timeline.

A harness exposes browser-safe CLI metadata from `./cli` when the settings UI needs it. Its runtime entry implements native behavior such as model IDs, launch options and configuration formats. For example, [Cline](../agent-runtime-cline-acp/src/adapter.ts) resolves the same provider profile for launch and gateway attribution. [Poolside](../agent-runtime-poolside-acp/src/adapter.ts), [CodeBuddy](../agent-runtime-codebuddy-acp/src/adapter.ts) and [Goose](../agent-runtime-goose-acp/src/adapter.ts) share their native configuration readers with the settings editor. Poolside binds the session credential to the child environment. [Antigravity](../agent-runtime-antigravity-acp/src/cli.ts) declares the login fields used by Settings. Its [terminal entry](../agent-runtime-antigravity-acp/src/terminal.ts) encodes the model address for launch and decodes it at the gateway. Common descriptor types are exported from `@cherrystudio/agent-runtime-acp/profile`.

Settings use `connectAcpManagementStdio`. Its handshake returns agent information, authentication and model discovery. Authentication checks the advertised method ID and distinguishes terminal sign-in. A management connection can advertise URL elicitation for sign-in when the host supplies a browser consent callback. Model discovery opens a temporary session with an empty MCP list, reads its model options and returns its negotiated close operation to the process owner. Management uses the same protocol client. The replay access from `createAcpRuntime` constructs a recovery projection. Desktop chat uses Cherry’s persisted timeline and keeps only bounded setup and turn-overlap updates.

Chat and thread handles use the same implementation. Each native session has one control state within its connection. Advertised model candidates, standard configuration and legacy model writes use the same validation and confirmation. A notification processed during a write takes precedence over its later response. Only one control write can be pending per session.

The package pins the TypeScript SDK to 2.4.0. Its default import selects stable ACP v1 and the handshake sends protocol version 1.

The desktop handle’s `acp.runPrompt` returns the stop reason, validated token usage and any harness-reported context reading for the submitted revision. Some v1 agents include a top-level `usage` extension. The Grok Build adapter can also read its native response metadata or a live completion for that exact prompt. Custom ACP presets use the generic path.

Chat adapters can register typed reverse requests through `AcpHarnessAdapter.registerRequests`. The SDK routes each reply to the incoming JSON-RPC request and supplies its cancellation signal. The Grok Build adapter owns the question and plan wire formats. The desktop host checks the active session and turn before presenting either request.

Create one runtime per backend connection. `create` starts a native session; `open` reuses a live owner or loads native history using the host's saved configuration. Observing and releasing handles never prompt, reload, cancel, or close sessions. `shutdown` joins the host transport lease and drains published observations. A failed join returns `unknown` and may be retried.

Only one local prompt may run per session. Submission acknowledges dispatch, not acceptance or durable placement. Interrupt waits for the captured prompt's response. Transport loss leaves the outcome unknown. No request is automatically retried.

The `acp` facet retains native content and metadata. IDs generated for chunks without native message IDs belong to one projection epoch; they are not archive locators. Slow observers receive an explicit gap and recovery state; exceeding the bounded native-event backlog ends that observer.

## Host contract

```ts
import { runtimeId } from '@cherrystudio/agent-runtime'
import { createAcpRuntime } from '@cherrystudio/agent-runtime-acp/v1'

const runtime = createAcpRuntime({
  backendId: runtimeId<'backend'>('my-acp-agent'),
  connect: () => host.acquireTransport(),
  loadConfiguration: (thread) => host.savedConfiguration(thread),
  report: (error) => host.report(error),
  callbacks: { permission: (request, context) => host.choosePermission(request, context) }
})
const session = await runtime.create({ cwd: '/absolute/workspace', mcpServers: [] })
```

`host.acquireTransport()` returns an SDK `Stream` and `closeAndJoin()`. Use the stable SDK's `ndJsonStream` for byte transports. A lease must be exclusive to this runtime; its join must prove source termination, including child-process exit, and remain retryable after failure. Native session configuration and MCP endpoints come from the trusted host. Initialize/authenticate use advertised native authentication method IDs; there is no credential store here.

Filesystem callbacks are independent. Advertising terminals requires all five terminal handlers. Chat elicitation supports session-scoped forms. Host callbacks receive the thread identity and an abort signal; permission choices must use the agent's offered option IDs. There is no default approval. A permission callback belongs to its captured prompt, so a late answer cannot authorize a later turn.

A desktop host can use `AcpHarnessAdapter.permissionQuestion` to interpret a native question carried by the standard permission request. `describePermissionOption` supplies native scope and warning metadata to `mapAcpPermissionOptions`. The host owns prompting, cancellation and grants it issues locally.

`acp.submit` accepts stable native content blocks. Text and resource links are baseline inputs; embedded resources require `embeddedContext`. `acp.setMode` and `acp.setConfigOption` validate the returned catalogs. `acp.observe` captures native updates alongside normalized revisions and supplies materialized native state on baseline/recovery snapshots. `acp.state()` includes exact prompt responses, tools, content chunks, current configuration and latest metadata by update kind. Context occupancy requires a standard model config option plus native `usage_update`; changing model identity invalidates the common reading until fresh usage arrives, while retaining raw native metadata. Legacy model extensions stay native and do not imply a confirmed common reading.

Setup buffering is limited to 256 updates or 8 MiB per pending session. Interrupt and shutdown waits have a 10-second deadline; exceeding it returns `unknown`. An interrupt timeout retains the busy slot until a native terminal boundary. The host must finish or retry a failed shutdown; releasing handles does not join sources.

## Verification

```sh
pnpm --filter @cherrystudio/agent-runtime-acp build
pnpm --filter @cherrystudio/agent-runtime-acp typecheck
pnpm test:agent-runtime-acp packages/agent-runtime-acp/tests/runtime.test.ts packages/agent-runtime-acp/tests/lifecycle.test.ts
```

The protocol tests use the actual SDK over NDJSON streams and an owned child process. Native acceptance is opt-in and checks the executable package versions. Install the test harnesses outside this workspace so they do not become adapter dependencies:

```sh
npm install --prefix /tmp/cherry-acp-native --ignore-scripts @agentclientprotocol/claude-agent-acp@0.101.0 @anthropic-ai/claude-agent-sdk@0.3.318 @google/gemini-cli@0.67.0
ACP_CLAUDE_BIN=/tmp/cherry-acp-native/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js \
ACP_GEMINI_BIN=/tmp/cherry-acp-native/node_modules/@google/gemini-cli/bundle/gemini.js \
pnpm test:agent-runtime-acp packages/agent-runtime-acp/tests/native.test.ts
```

These tests use isolated homes, local model endpoints, synthetic credentials and real native file tools. Each harness must complete a conversation, request tool permission, cancel an in-flight model response, and reload its native history in a fresh process. Claude uses its advertised `default` permission mode; the fixture separately answers native title-generation requests. Gemini 0.67.0 returns `session/load` before finishing replay, so acceptance awaits observed history rather than treating the load response as a complete archive snapshot. This differs from the newer Gemini source pinned in the research note.

Native acceptance was run on macOS with Node 24.21.0. It is skipped without the executable variables and on Windows; a skip is not acceptance. These tests do not establish Electron integration, provider installation, account UI, real-provider billing, or Windows packaging.
