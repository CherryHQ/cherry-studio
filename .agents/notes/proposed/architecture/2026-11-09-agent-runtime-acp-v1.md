# Agent Note: ACP v1 runtime adapter

Status: proposed

English | [中文](2026-11-09-agent-runtime-acp-v1.zh.md)

## Problem

Cherry has common [runtime contracts](../../../../packages/agent-runtime/README.md) and native Pi, Pi Durable, and Claude Code adapters, but no portable ACP adapter on `main` at `27a61a606566`. ACP is the client protocol of a harness, not an execution engine. Connecting an agent does not transfer ownership of its model loop, storage, tools, or children to Cherry.

The requested target is a general `@cherrystudio/agent-runtime-acp/v1` adapter, with Claude ACP and Gemini CLI as the first compatibility samples. This note specializes the [harness boundaries](2026-10-17-agent-harness-boundaries.md) without changing the common contract. The earlier [five-sample evidence](../testing/2026-10-17-agent-harness-evidence.md) remains historical evidence at its own pinned revisions.

Related [PR #21221](https://github.com/CherryHQ/cherry-studio/pull/21221), inspected at `909ce14a6882`, already contains a desktop `localAgent/AcpConnection.ts`. It also owns launch, authentication, filesystem/terminal callbacks, and product usage. That unmerged implementation is integration evidence, not code present on this branch. The portable package must not become a second production connection owner alongside it; desktop adoption requires a separately scoped migration of the owning connection.

## Proposal

### Research baseline

Source inspection and execution are separate evidence. Research was refreshed on 2026-11-09.

| Source | Fixed baseline | Finding |
| --- | --- | --- |
| ACP protocol | [`7441d106a853`](https://github.com/agentclientprotocol/agent-client-protocol/tree/7441d106a853682cce61d2dd7db54123e4b9a477) | Stable v1, unstable v1, and draft v2 are separate schemas. |
| TypeScript SDK | [`2.4.0`, `0f8c75079ae0`](https://github.com/agentclientprotocol/typescript-sdk/tree/0f8c75079ae07e6edd2feb626f5598a92632eead) | The default import is stable v1; `client`, `agent`, `ndJsonStream`, connection lifetime, and request cancellation are provided by the library. |
| Claude ACP | [`0.101.0`, `3b22586cf63c`](https://github.com/agentclientprotocol/claude-agent-acp/blob/3b22586cf63cef06f1029a8418a9abb3b2cc3236/src/acp-agent.ts) | v1 prompts await turn outcomes. Native queueing is advertised under `_meta.claudeCode.promptQueueing`; child controls and richer routing use extensions. |
| Gemini CLI source | [`62bab5b232c1`](https://github.com/google-gemini/gemini-cli/blob/62bab5b232c15b925d31e655ce844ab939c882b7/packages/cli/src/acp/acpSession.ts) | `prompt()` aborts the previous pending prompt. Loading an already active session disposes and replaces that session. This is not a passive observation operation. |

The protocol repository and SDK are not interchangeable version pins. For example, the protocol baseline includes `sessionCapabilities.systemPrompt` in stable v1, while SDK 2.4.0 exposes it only in its unstable schema. The initial implementation uses the published SDK's stable surface. It does not copy newer protocol types or silently import `/unstable`.

| Behavior | Stable v1 evidence | Adapter consequence |
| --- | --- | --- |
| Input and completion | [`session/prompt`](https://github.com/agentclientprotocol/agent-client-protocol/blob/7441d106a853682cce61d2dd7db54123e4b9a477/docs/protocol/v1/prompt-turn.mdx) returns `stopReason` after the turn; there is no separate prompt-acceptance response or persistent run ID. | Local dispatch, native placement, and terminal outcome remain separate. |
| Busy input | No common steer/follow-up operation; the two sample implementations differ. | Permit one in-flight prompt per owned session and support common `whenBusy: reject` only. |
| Content | Message IDs are optional; tool calls have IDs and partial updates. Output can include text, reasoning, images, audio, links, resources, diffs, and terminal references. | Preserve source fields and do not invent durable message identity or tool execution from a display update. |
| Recovery | [`loadSession`](https://github.com/agentclientprotocol/agent-client-protocol/blob/7441d106a853682cce61d2dd7db54123e4b9a477/docs/protocol/v1/session-setup.mdx) is negotiated and replays history before its response. Resume and close have separate capabilities. | Reuse live owners; only cold-open through the negotiated native load operation. Missing support or history is not a new session. |
| Cancellation | Cancel is a notification; pending permissions need `cancelled` replies, and final updates precede the prompt response. | Sending cancel is not confirmed termination. Keep consuming until the captured prompt settles. |
| Host callbacks | Filesystem, terminals, and elicitation depend on client capabilities; permissions carry agent-offered option IDs. | Advertise only implemented host callbacks and retain native permission choices. |
| Configuration and usage | Modes, config options, commands, plans, context/cumulative cost updates, notices, and compaction are distinct protocol facts. | Keep typed ACP facts; context occupancy and cumulative cost are not per-turn billable usage. |
| Children and advanced controls | Stable v1 does not supply the experimental subagent control protocol, native queueing, or universal provider selection. | Do not expose common child controls or infer children from tool titles. |

### Package and resource ownership

Add `packages/agent-runtime-acp`, exporting `/v1` explicitly. Depend on `@cherrystudio/agent-runtime` and exact `@agentclientprotocol/sdk@2.4.0`; use the existing SDK content protocol through the common package. No Electron, product database, agent installer, credential manager, or native-harness dependency belongs in the package. No new public type is needed in the common runtime.

`createAcpRuntime` owns one configured backend namespace and its ACP connection. The host supplies an exclusive transport lease with a close-and-join operation, native session configuration lookup, diagnostics, and supported client callbacks. The SDK owns framing, JSON-RPC correlation, validation of incoming method parameters, and connection requests. The adapter owns initialization, session routing, input bookkeeping, normalized feeds, and access lifetime. The host remains responsible for executable resolution, process launch, credentials, path policy, and joining an owned process on shutdown. Closing an SDK connection alone does not prove process exit.

Register callbacks before initialization and require protocol version 1. Use `ClientApp.connect`, whose connection has an explicit lifetime; a `connectWith` callback returning a runtime would close its transport. Gate optional operations against negotiated capabilities and returned session configuration. Advertised extensions remain native metadata and do not authorize calling methods absent from the stable entrypoint.

`create` uses native `session/new`. `open` validates the backend and reuses an existing session owner before considering `session/load`. The host provides the saved `cwd` and MCP configuration for cold load; displayed messages are never converted into native context. Capture setup-time updates before new/load responses, including updates emitted before a new session ID is returned. Bound provisional routing and fail explicitly on overflow; never silently drop history or assign it to another session. New-session creation can be serialized at the connection boundary to avoid ambiguous provisional routing, without serializing prompts across independent sessions.

Each live session has one projection producer and independently releasable handles. `observe`, `Observation.stop`, and `release` do not prompt, reload, cancel, or close the native session. Runtime shutdown closes admission, settles pending permission callbacks, requests supported native termination, joins the transport lease, drains published observations, and then ends feeds. Failure to confirm source termination returns `unknown`; it does not erase the owner or claim a successful shutdown. No operation deletes native history.

### Input and terminal facts

Reserve the session's in-flight slot before asynchronous dispatch. Reject concurrent local submissions before sending them. `steer` and `follow-up` return `unsupported`, including on an idle session, until a separately specified native facet establishes their semantics. External clients or autonomous work can still change native activity; local exclusivity is not a protocol-wide idle guarantee.

The immediate submit receipt records only `dispatch-started`. It does not assert acceptance, durable storage, model consumption, or placement. Keep the host `inputId` locally; do not turn a JSON-RPC ID into `NativeInputRef`. Duplicate local IDs are rejected without another dispatch, but this is not durable deduplication. No automatic prompt retry follows timeout or transport loss.

The original prompt response owns its terminal outcome: `end_turn` means the native turn completed, `cancelled` means aborted, and `max_tokens`, `max_turn_requests`, or `refusal` mean unanswered under the common contract. Retain the exact native stop reason in the ACP view. A remote request error records failure without promising that tools had no effects. Transport loss leaves execution outcome unknown and publishes a gap; it cannot manufacture completion or a cancellation acknowledgement.

`interrupt` captures the current in-flight prompt, closes its permission requests with `cancelled`, and sends `session/cancel`. It waits for that prompt's native response or source failure, while retaining final output. An independently completed prompt racing cancel retains its actual stop reason. A transport or deadline failure returns `unknown` and does not release the busy slot as if cancellation succeeded. Request-level `$/cancel_request` is a different SDK operation and must not replace session cancellation.

### Content and host interaction

Use `ThreadFeed` and the existing content accumulator for `RuntimeMessage` projection. Scope native IDs to their session and content kind. Keep reasoning and tool-result updates in ordered parts, and apply partial tool patches without erasing omitted fields. When a harness omits message IDs, use projection-local IDs and explicitly reset the mapping on cold replay; these IDs are neither native history locators nor exactly-once merge keys. Do not correlate an echoed user chunk to an input by text equality.

A typed `acp` facet supplies native submission content, negotiated/session configuration, and observation of native updates captured with their normalized revision. It preserves content that the common display cannot express, including resource/diff/terminal metadata and `_meta`. Metadata-only updates must remain observable. Plans, modes, commands, notices, compaction, and cost never settle a prompt. Resource links and terminal references do not authorize automatic fetching or command execution.

Permission callbacks receive the native request, session identity, offered options, and a cancellation signal. Validate a selected option against the offered IDs; absent handlers, cancelled turns, and shutdown resolve as `cancelled`. A stale permission response cannot authorize another prompt. Filesystem, terminal, and elicitation handlers remain host-owned and session-scoped; absent implementations advertise no support. MCP endpoints come from trusted host configuration and use only negotiated transports. The adapter never adds an automatic-approval policy.

Context reads are passive. A confirmed common context reading requires native capacity/occupancy evidence and an established model identity; otherwise return `unknown` or `unsupported` and retain the raw ACP usage update. Do not guess the model, substitute billing counters for context occupancy, or charge a replayed cumulative cost. Stable v1 does not enable common subagent access. Existing direct Claude Code integration remains the owner of capabilities specific to that SDK.

### Verification and implementation layers

Executed research uses published SDK 2.4.0 over real NDJSON streams with a scripted protocol peer: initialization/new session, output and permission while prompt is pending, cancelled permission plus trailing tool update before the prompt response, replay before load response, and pending-request rejection on connection loss all passed. This verifies transport behavior, not a Cherry adapter or a native model loop.

Isolated subprocess initialization also passed for published Claude ACP 0.101.0 and Gemini CLI 0.67.0. Both negotiated v1 and advertised history loading, image input, embedded context, and HTTP/SSE MCP; Gemini also advertised audio. Claude advertised additional session capabilities and extension metadata. The older locally installed Gemini 0.19.4 timed out during initialization and is not an accepted baseline. These probes used temporary homes/workspaces with no authentication or model request. They do not prove prompting, tools, cancellation, recovery, or desktop integration on either real harness.

The Spec is the bottom layer. After approval, the package layer implements the contracts with explicit-path tests for public adapter calls over the real SDK and a child-process fixture. The native acceptance layer exercises Claude and Gemini processes with controlled model endpoints and isolated storage. Record exact package versions and scenarios; do not substitute mocked RPC replies for native loop acceptance. Only cumulative evidence covering every AC moves this note to implemented. Desktop adoption, service installation, account UI, provider routing, and experimental v1/v2 features require separate scopes.

## Alternatives considered

- Copy a JSON-RPC client or older `ClientSideConnection` examples: rejected because SDK 2.4.0 already provides the transport and explicit connection lifecycle.
- Import unstable v1 or draft v2 to obtain every Claude feature: deferred because that changes the compatibility target and does not establish Gemini support.
- Normalize queueing, children, and durable identities from tool names or method names: rejected because source evidence contradicts those guarantees.
- Move the desktop connection wholesale into the package: rejected because launch, credentials, product usage, and host filesystem policy belong to the desktop host; migrate consumers in a separately approved integration change.

## Acceptance criteria

- AC1 — `/v1` builds and typechecks against exact stable SDK 2.4.0 without Electron, product data, native SDK dependencies, or changes to the common runtime contract; incompatible protocol versions are refused. (verification: unit — package typecheck and initialization integration tests)
- AC2 — Concurrent opens share one live owner; cold load captures replay before its response; absent capability, missing history, and setup-buffer overflow fail explicitly without creating a replacement session or mixing content. (verification: unit — public runtime lifecycle tests over SDK transport)
- AC3 — Submit returns before turn completion with only dispatch evidence; a busy or duplicate submission is not sent; unsupported policies, remote errors, limits/refusal, and source loss retain their specified outcomes without retry. (verification: unit — public input integration tests)
- AC4 — Permission selection uses offered IDs; interruption cancels pending permissions, retains trailing updates, and confirms only the captured native prompt boundary; stale replies and transport failure cannot grant permission or claim cancellation. (verification: unit — bidirectional SDK cancellation tests)
- AC5 — Text, reasoning, tool patch updates, rich native content, and metadata updates survive observation and replay with explicit identity limits; slow consumers, overflow, and release do not change execution or another observer. (verification: unit — projection and observation integration tests)
- AC6 — Optional controls and host callbacks require actual support; context reads remain passive and unknown model/context data stays unknown; cumulative cost and experimental child metadata cannot fabricate billing or common controls. (verification: unit — capability and callback integration tests)
- AC7 — Shutdown joins the owned transport/process and published delivery; failed termination remains unknown, while releasing one access leaves other accesses and native work intact and history undeleted. (verification: unit — child-process lifecycle integration tests)
- AC8 — Pinned Claude ACP and Gemini processes each complete a scripted-model conversation, tool permission round trip, cancellation, and native history reload; evidence distinguishes those tests from handshake-only probes and Electron acceptance. (verification: unit — native subprocess integration tests with controlled model endpoints)

## Risks

SDK and protocol schemas evolve independently, and agents may emit extension fields even to a stable client. Native facts need typed preservation without assuming support. Optional message IDs limit durable display reconciliation. Some agents continue autonomous work or can be controlled by another client, so prompt completion is not whole-harness quiescence. Host callbacks and native close behavior need cancellation tests, not just happy-path API calls. The related desktop PR may land before package adoption; refresh its actual owner and avoid duplicate readers or process managers.
