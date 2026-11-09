# ACP v1 runtime

`@cherrystudio/agent-runtime-acp/v1` adapts stable ACP v1 to the [common runtime](../agent-runtime/README.md). The SDK owns protocol framing; the host supplies an exclusive transport lease, native session configuration, credentials, and supported callbacks. The adapter does not launch agents, approve tools, fetch resources, or delete history.

Implementation follows the [ACP Spec](../../.agents/notes/implemented/architecture/2026-11-09-agent-runtime-acp-v1.md). Desktop adoption is separate.

## Ownership

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

Filesystem callbacks are independent. Advertising terminals requires all five terminal handlers. Elicitation supports session-scoped forms only. Host callbacks receive the thread identity and an abort signal; permission choices must use the agent's offered option IDs. There is no default approval. A permission callback belongs to its captured prompt, so a late answer cannot authorize a later turn.

`acp.submit` accepts stable native content blocks. `acp.setMode` and `acp.setConfigOption` validate the returned catalogs. `acp.observe` captures native updates alongside normalized revisions and supplies materialized native state on baseline/recovery snapshots. `acp.state()` includes exact prompt responses, tools, content chunks, current configuration and latest metadata by update kind. Context occupancy requires a standard model config option plus native `usage_update`; legacy model extensions stay native and do not imply a confirmed common reading.

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
