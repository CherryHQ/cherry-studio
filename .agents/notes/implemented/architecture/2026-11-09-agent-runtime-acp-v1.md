# Agent Note: ACP v1 runtime adapter

Status: implemented

English | [中文](2026-11-09-agent-runtime-acp-v1.zh.md)

## Problem

Cherry has common [runtime contracts](../../../../packages/agent-runtime/README.md) and native Pi, Pi Durable, and Claude Code adapters, but no portable ACP adapter on `main` at `27a61a606566`. ACP is the client protocol of a harness, not an execution engine. Connecting an agent does not transfer ownership of its model loop, storage, tools, or children to Cherry.

The requested target is a general `@cherrystudio/agent-runtime-acp/v1` adapter, with Claude ACP and Gemini CLI as the first compatibility samples. This note specializes the [harness boundaries](../../proposed/architecture/2026-10-17-agent-harness-boundaries.md) without changing the common contract. The earlier [five-sample evidence](../../proposed/testing/2026-10-17-agent-harness-evidence.md) remains historical evidence at its own pinned revisions.

Related [PR #21221](https://github.com/CherryHQ/cherry-studio/pull/21221), inspected at `909ce14a6882`, already contains a desktop `localAgent/AcpConnection.ts`. It also owns launch, authentication, filesystem/terminal callbacks, and product usage. That unmerged implementation is integration evidence, not code present on this branch. The portable package must not become a second production connection owner alongside it; desktop adoption requires a separately scoped migration of the owning connection.

## Decision

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

`packages/agent-runtime-acp` exports `/v1` explicitly. Depend on `@cherrystudio/agent-runtime` and exact `@agentclientprotocol/sdk@2.4.0`; use the existing SDK content protocol through the common package. No Electron, product database, agent installer, credential manager, or native-harness dependency belongs in the package. No new public type is needed in the common runtime.

`createAcpRuntime` owns one configured backend namespace and its ACP connection. The host supplies an exclusive transport lease with a close-and-join operation, native session configuration lookup, diagnostics, and supported client callbacks. The SDK owns framing, JSON-RPC correlation, validation of incoming method parameters, and connection requests. The adapter owns initialization, session routing, input bookkeeping, normalized feeds, and access lifetime. The host remains responsible for executable resolution, process launch, credentials, path policy, and joining an owned process on shutdown. Closing an SDK connection alone does not prove process exit.

Register callbacks before initialization and require protocol version 1. Use `ClientApp.connect`, whose connection has an explicit lifetime; a `connectWith` callback returning a runtime would close its transport. Gate optional operations against negotiated capabilities and returned session configuration. Advertised extensions remain native metadata and do not authorize calling methods absent from the stable entrypoint.

`create` uses native `session/new`. `open` validates the backend and reuses an existing session owner before considering `session/load`. The host provides the saved `cwd` and MCP configuration for cold load; displayed messages are never converted into native context. Capture setup-time updates before new/load responses, including updates emitted before a new session ID is returned. Bound provisional routing and fail explicitly on overflow; never silently drop history or assign it to another session. New-session creation is serialized at the connection boundary to avoid ambiguous provisional routing, without serializing prompts across independent sessions.

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

### Implementation and native evidence

[Spec PR #23916](https://github.com/CherryHQ/cherry-studio/pull/23916) merged at `724130665f2e`, and the user explicitly authorized implementation in the task conversation. This package completes the adapter and native acceptance layers. The historical research probes established only transport behavior and isolated initialization; they did not claim a Cherry adapter or native model loop. The older Gemini 0.19.4 initialization timeout remains outside the accepted baseline.

The implemented package uses the SDK's stable client, `ThreadFeed` and `RuntimeMessageStream`. Protocol tests exercise public adapter calls over real SDK transports and an owned child process. Native tests run published Claude ACP and Gemini processes with isolated storage and controlled model endpoints. They verify actual file-tool effects and reload history through ACP in a fresh process. Desktop adoption, installation, account UI, provider routing and experimental v1/v2 controls remain separate scopes.

## Alternatives considered

- Copy a JSON-RPC client or older `ClientSideConnection` examples: rejected because SDK 2.4.0 already provides the transport and explicit connection lifecycle.
- Import unstable v1 or draft v2 to obtain every Claude feature: deferred because that changes the compatibility target and does not establish Gemini support.
- Normalize queueing, children, and durable identities from tool names or method names: rejected because source evidence contradicts those guarantees.
- Move the desktop connection wholesale into the package: rejected because launch, credentials, product usage, and host filesystem policy belong to the desktop host; migrate consumers in a separately approved integration change.

## Consequences

SDK and protocol schemas evolve independently; extension metadata does not enable unsupported controls. Native IDs remain session/content-kind scoped, and absent IDs remain projection-local. Prompt completion is not whole-harness quiescence. Stable model configuration plus native occupancy is required for common context usage; legacy model extensions and cumulative billing remain native facts. The host owns executable, credential, filesystem and terminal policy.

Setup buffering is bounded to 256 updates or 8 MiB. Cancellation and shutdown waits use 10-second deadlines and retain unknown outcomes when confirmation fails. Terminal support requires every terminal callback. Elicitation advertises session-scoped forms only; URL and request-scoped elicitation are not supported.

Published Gemini 0.67.0 starts history replay without awaiting it before returning from `session/load`; the newer researched source awaits replay. The adapter retains late updates, and native acceptance waits for the expected history to arrive. A successful load response from that binary is not proof of complete replay. Claude acceptance selects the advertised `default` permission mode, since its initial mode can allow edits, and the model fixture handles separate title-generation requests. Native acceptance is opt-in, with version checks; missing binaries and Windows are explicitly skipped, not counted as passed.

## Verification

The commands below ran on macOS with Node 24.21.0 and pnpm 12.6.0. The protocol suite uses SDK 2.4.0 over real NDJSON streams; the native suite launches isolated subprocesses against controlled loopback model endpoints. Native binaries are external test inputs, not package dependencies. Reproduction commands and environment variables live in the [package README](../../../../packages/agent-runtime-acp/README.md).

- AC1 — Package `build` and `typecheck`, plus `runtime.test.ts`: the `/v1` export builds with stable SDK 2.4.0, rejects incompatible initialization, and leaves common runtime contracts unchanged.
- AC2 — `runtime.test.ts` and `lifecycle.test.ts`: concurrent opens share an owner; new/load replay is routed by session; missing history, unsupported load, foreign backends and bounded setup overflow fail without creating a replacement.
- AC3 — `runtime.test.ts`: dispatch-only acknowledgement, synchronous busy reservation, local duplicate rejection, independent sessions, unsupported policies, exact stop outcomes, remote failure and disconnect without retry.
- AC4 — `runtime.test.ts` and `lifecycle.test.ts`: offered permission IDs, cancelled pending permission, stale reply rejection, trailing output, completion racing cancellation, source loss and cancellation deadline retaining the busy slot.
- AC5 — `runtime.test.ts` and `lifecycle.test.ts`: text/reasoning and text/file/text order, merged tool patches, retained resources/diffs/metadata, session-scoped IDs, observer isolation, overflow recovery and closure of only the overloaded observer.
- AC6 — `runtime.test.ts` and `lifecycle.test.ts`: capability-gated content/MCP/configuration, scoped filesystem and full terminal callbacks, form elicitation, passive context evidence, preserved cumulative cost and absent common child controls.
- AC7 — `lifecycle.test.ts`: real child-process exit, failed join and retry, late transport acquisition, delivery drain and native-history preservation; handle release leaves another access alive.
- AC8 — `native.test.ts`: Claude ACP 0.101.0 with Claude Agent SDK 0.3.318 and Gemini CLI 0.67.0 each complete conversation, real file-tool permission, in-flight cancellation and history reload in a fresh process. Both executable variables were supplied; neither native case was skipped.

The changed validation planner also passes `scripts/__tests__/validationPlan.test.ts`. Electron adoption, real-provider billing, Windows native acceptance and packaging are outside this evidence.
