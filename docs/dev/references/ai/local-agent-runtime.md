---
description: Local CLI agent configuration, native model ownership, protocol drivers, installation reuse, and compatibility verification
sources:
  - src/shared/ai/localAgentUsage.ts
  - src/shared/ai/localAgent.ts
  - src/shared/ai/agentSessionCost.ts
  - src/shared/ai/executionIdentity.ts
  - src/main/ai/runtime/localAgent
  - src/main/ai/agentSession/AgentSessionRuntimeService.ts
  - src/main/services/codeCli/CodeCliService.ts
  - src/main/services/deepSeekHarness
  - src/main/services/OpenClawService.ts
  - src/main/features/apiGateway/proxyStream.ts
  - src/renderer/pages/code/components/LocalAgentDirectory.tsx
  - src/renderer/pages/code/CodeCliPage.tsx
---

# Local Agent Runtime

Settings → Agent Services manages local CLI installation, sign-in, models and
configuration. The launchpad, sidebar shortcuts and legacy `/app/code` URLs open
the same settings tab and preserve the selected Agent. The conversation sidebar
shows enabled Agents. Local refers to the CLI process, which may call a remote
model. A Cherry model provider is optional.

Each preset has a stable Agent ID. Custom ACP Agents have independent IDs.
Disabling requires confirmation and archives the Agent and its active conversations
after running tasks stop. It also stops the managed WebUI. Re-enabling restores
the same identity, configuration, ordering and conversations archived with the
Agent. Independently archived conversations stay archived. A moved custom
executable can be verified and updated during restore. Permanent removal follows
the archive retention policy.

A new task has a managed directory by default. Before the first message, users can
choose an existing project. Changing the directory invalidates the existing
connection and its native resume ID, even if the original connect is still
pending. The first message locks the Agent and directory. Missing project
directories fail explicitly.

Local Code Mate tasks use `agent_list` and `agent_delegate`. Startup removes retired
shell wrappers only when the installed skills are app-owned. User-owned copies
are preserved.

## Ownership and routing

- SQLite stores `configuration.localRuntime`. Writes merge supplied fields in the
  transaction. Omitted fields retain their latest values and explicit `undefined`
  clears an optional field. Discovery, checks and session capability reads use IpcApi.
- `AgentSessionRuntimeService` owns scheduling, approvals, persistence and disposal.
  The local driver translates events from ACP, Cursor SDK, Claude Agent SDK and Codex App Server
  into the shared runtime contract. Each turn establishes a source in its session
  context before publishing addressed text, reasoning, plan and tool updates.
  Opening history reads known session capabilities. A command request or send can
  acquire a connection.
- ACP chat and Settings use separate entries in `@cherrystudio/agent-runtime-acp/v1`.
  Chat binds prompt, configuration, cancel and close to the native session ID. Checks
  and sign-in only perform the handshake and the requested authentication. Model
  discovery opens a temporary session, reads its reported catalog and closes it when
  supported. Settings connections expose no host files, terminals or browser MCP.
  Main owns the child process and reads conversation history from Cherry's archive.
- Streams use `runtime:<agent-id>` as execution identity. It belongs to the stream.
  Persisted messages retain author and native model attribution when available.
- Cursor uses the bundled TypeScript SDK for login, model discovery and session recovery.
  The Agent stores the selected SDK model ID and passes it to both create and resume.
  The SDK mounts each run's private `/tmp` over an empty virtual filesystem. Native
  Read and Grep can read MCP output stored there. Cherry's host tools operate on the
  selected workspace. Writes, edits and commands require approval of the individual call.
  Plan mode blocks those operations after a mode change as well as before approval.
  The optional browser endpoint keeps its session-scoped lease. Session recovery uses the SDK agent ID. [Cursor SDK documentation](https://cursor.com/docs/api/sdk/typescript)
- For CLI-backed routes the CLI owns authentication, project settings, MCP and Skills. Local turns use
  native resources and controls. Main rejects Cherry knowledge scopes for these turns.
- When host browser control is enabled, interactive sessions expose Cherry Studio's
  session-scoped built-in browser `automation` MCP (`LocalAgentMcpBridgeService`) over
  loopback Streamable HTTP with a per-session bearer token (or `stdioHttpMcpShim` when
  an ACP agent lacks HTTP MCP capability). Per-agent `browserControl` (`inherit`,
  `readonly`, or `disabled`, defaulting to `disabled` for custom ACP) and session mode
  (`plan` / `readOnly`) enforce read-only or disabled isolation; headless scheduled tasks
  and OpenClaw's ACP bridge (which rejects per-session `mcpServers`) omit browser
  injection, and injected `automation` tool calls auto-approve across Claude, Codex, and
  ACP when host control is allowed.

### Models and configuration

Agent Services offers native models and Cherry models through the unified gateway.
For CLIs with writable defaults, selecting a model updates both the native file
and the Agent record. A failed update restores the file or the selection as
appropriate. Stale editor drafts fail before writing. Gateway selections keep
the Cherry model ID separately from the native ID and inject only Cherry gateway
credentials. Switching back removes Cherry-owned configuration while preserving
user settings and credentials.

For Grok Build, applying a Cherry model also binds the native `session_summary`
and `prompt_suggestion` roles. User-pinned roles keep their own model. Gateway
configuration gives the summary a dedicated Chat Completions endpoint, including
when the primary conversation uses Responses. Existing installations pick up the
binding the next time the model configuration is applied.

New chats, terminal sessions and managed WebUIs use the native default. Model
arguments, environment and project settings can override it. Open sessions keep
their current model. Antigravity applies the saved ACP model when opening or
resuming chat and retains a separate terminal default. Cline uses the active provider
profile, including explicit overrides, for model selection and usage attribution.
Presets without an applicable model control follow their CLI default.

Presets with native files use the shared **CLI configuration files** editor,
which opens without a Cherry model selection. DeepAgents instead uses launch
arguments and environment. DeepSeek Harness and Hermes require their managed
service to stop before editing. Raw edits retain native file formats, check for
concurrent edits and synchronize only Agents using the same configuration root.

### WebUI and managed gateways

The WebUI start/stop control manages a Cherry-owned process. **Open WebUI** opens
the running service in a separate action. External services are open-only.

- OpenClaw pairs a native Gateway with its ACP bridge. Chat leases share the
  Gateway and keep it alive until the last lease closes. Explicit WebUI use
  retains the service. Cherry reuses healthy external Gateways and stops only
  process trees it owns. Explicit Gateway URLs and native state/config overrides
  bypass automatic management. Password sign-in uses OpenClaw's own page. Token
  sign-in can use a Dashboard bootstrap.
- OpenClaw's Cherry gateway models require Cherry to be running. User-edited
  conversation names take precedence over bridge UUIDs and technical titles. Cherry
  prefers `session/load` because the bridge may lose UUID mappings across restarts.
  Native database failures surface `openclaw doctor --fix` guidance.
- DeepSeek Harness uses `dsh --profile acp`. The managed ACP, WebUI and headless
  profiles share the home `cordis.patch.yml`. Retained catalogs support resuming
  sessions after `settings.yaml` migrates. Credentials, settings and profile
  patches share write and rollback checks. Explicit `DSH_HOME` uses its own
  profile. Managed tasks connect on first send, so the model remains editable
  until then.

## Installation and connection

The [preset catalog](../../../../src/shared/ai/localAgent.ts) and
[installation recipes](../../../../src/main/ai/runtime/localAgent/installRecipe.ts)
own executable names, arguments and package sources.

- Discovery favors system commands and user-directory entries over legacy mise
  shims. It resolves symlinks to preserve managed ownership and checks executable
  names and aliases. Explicit overrides take precedence and fail without fallback.
  Launcher resolution repeats on each connection so upgrades use the current path.
  Installed DeepSeek versions without an ACP profile are skipped when identified.
- Managed commands use Cherry's binary environment. System commands keep the shell
  environment. Explicit overrides apply last and participate in executable lookup.
  Windows matches environment keys case-insensitively. Arguments stay structured
  and logs and DataApi devtools redact argument and environment values.
- Agent Services uses system package managers, official installers or registry
  archives. It rejects package manager targets inside Cherry-managed paths.
  Existing mise installations can be reused and removed. See
  [BinaryManager discovery rules](../binary-manager/README.md).
- Pi uses a bundled ACP adapter and the installed native CLI. OMP requires
  Bun 1.4.4 or newer. Amp chat requires both `amp-acp` and `amp`. Its terminal and CLI sign-in use `amp` directly. ZCode requires a separate native executable.
  Antigravity's terminal entry requires `agy`. DeepAgents checks its Anthropic
  and OpenAI provider packages even when reusing its adapter. Installation fails
  if a required dependency is missing after setup.
- Upgrades keep old managed resources for running terminals. Uninstall rechecks
  the confirmed installation and ownership of each component, verifies removal
  and reports partial failures. Shared runtimes, credentials, settings and
  conversations are preserved. Source-installed Hermes uses its native updater
  and data-preserving uninstaller. Installations with unverified ownership leave
  running sessions and WebUIs open and require the original installer or manual cleanup.

Passive discovery never starts the CLI. Check/enable performs a bounded handshake
without prompting the model or starting login. Discovery reports the installed
CLI version. The handshake reports the version supplied by the protocol peer.
`protocolInfo` records handshake,
session and prompt stages as each succeeds. Available tools, controls and resume
behavior depend on the connected CLI. Authentication and known timeouts have
separate recovery flows. An incompatible managed CLI can be kept alongside a
system install.

Terminal launch uses the native interactive command with a selected directory and
terminal application. Choices and removable recent directories are stored per tool.
A missing directory blocks launch. macOS starts terminals through an owner-only
script that removes itself before running the CLI. Failure, shutdown and expiry
clean up unused scripts.

### CLI sign-in

Agent Services uses native account-status commands where available and rechecks
on focus. Antigravity can infer sign-in from a successful live session. Cached
models and a handshake alone do not verify authentication. Background checks
stay quiet and explicit errors remain visible.

The sign-in dialog uses a built-in CLI login method or an advertised ACP method
after user action, then refreshes the catalog on success. Credentials remain
CLI-owned. Only environment overrides explicitly entered for sign-in are saved. Terminal-only and external API-key setup
remain in the native CLI flow. For Pi sign-in, the user selects or enters a provider.
Antigravity can fall back from the standalone adapter to `agy acp` with existing
terminal credentials. Explicit overrides retain their command.

The five-minute timeout, cancellation, program changes, panel closure and app
shutdown release the owned login process. Late results cannot save credentials or
report success. A failed post-login catalog refresh is shown on the Agent card
and can be retried. Errors from a Cherry gateway provider retain that provider's
recovery link.

## Protocol behavior

| Driver | Resume identity | Model control | Approval protocol |
| --- | --- | --- | --- |
| Claude Code | SDK session ID | SDK model catalog or CLI default | SDK `canUseTool` |
| Cursor SDK | Local SDK agent ID | SDK model catalog or Auto | Cherry approves workspace edits and program execution |
| Codex | App Server thread ID | `model/list` or CLI default | Native decisions and permission requests |
| ACP | ACP session ID | Model config option or legacy `session/set_model` | Original option IDs and scopes |

### Session controls

ACP `configOptions`, including an empty list, takes precedence over legacy modes.
Model config options similarly take precedence over the legacy model interface.
Unknown option types are ignored. Known labels are localized and native IDs and
custom text are preserved. A model absent from a non-empty catalog fails
explicitly. For Qwen, MiniMax and Hermes, Cherry maps provider-configured defaults
to advertised ACP IDs. CLIs with config-file-only model selection use the
configured default.

The composer applies confirmed session options. A reconnect validates remembered
choices against live options before replaying them. Failed changes retain the last
confirmed state and running turns block reconfiguration. Per-session permission
and effort overrides do not modify global CLI configuration. High-risk changes
require confirmation. `Shift+Tab` switches between the active safe mode and the
advertised plan or read-only mode. The renderer may display cached controls while
reconnecting, with edits and attachment capability gated on live session data.

### Approval and content

- Codex approval requests can inherit command, directory and file-change details
  from the matching item. Request fields take precedence. Item completion or the
  next turn clears those details. Codex retains the specific permissions granted
  for a session. Further permission requests require another decision.
- ACP tools merge updates by native call ID. Standalone approval cards settle
  independently. Client file writes require approval. A delegated terminal creation
  needs its own approval or an explicit session grant under the default policy.
  Terminals are connection-owned and working directories provide no OS isolation.
  A command path with spaces runs directly when it resolves to an executable.
  A legacy command string without an argument array can run as approved shell input.
- ACP thoughts become reasoning parts and plan updates replace the current turn's plan.
  Native message IDs provide attribution and do not replace Cherry message UUIDs.
  ACP suppresses transcript replay during load because Cherry already stores it.
  Pi startup banners reported as metadata are filtered only when the same startup
  text is echoed as assistant output.
- Tool details can include diffs, file links and terminal snapshots. Positive line
  numbers open read-only previews at the reported line. Snapshots remain readable
  after the process exits. Completed writes can appear under **File changes** and
  explicit artifacts under **Outputs**.
- ACP sends images only when the Agent advertises image input. File attachments
  use encoded resource links or embedded content when advertised. Embedded
  non-UTF-8 text files are sent as blobs with their original bytes.
  Missing files fail before prompting. The CLI still governs native file access.

### Failure, cancellation and usage

Stop requests protocol cancellation before closing the owned process tree if
necessary. Outstanding approvals settle as denied or cancelled. Partial output
survives failures. Cherry does not replay the prompt or replace a failed native
session with a new one. Non-resumable connections skip idle reclamation for
interactive and reusable task sessions. One-off task sessions use the standard
idle timeout. Closing a non-resumable connection can make it unrestorable.

ACP request cancellation is independent of turn cancellation. A cancelled
approval cannot authorize a later write or process start. Cancelling a terminal
wait leaves the terminal running. Interactive ACP turns expose output/request
limits and refusal as stream finish reasons. Scheduled runs fail on those stop
reasons and retain any partial reply.

ACP per-turn usage comes from the prompt result. The Grok Build adapter also
reads the prompt's `_meta.usage`. When both response fields omit usage, it accepts
a live completion only for the same native session and prompt ID. Background
completions and replayed notifications cannot contribute to the foreground turn.
Session usage updates report context occupancy and cumulative cost. For a normal Pi
reply, the bundled bridge reports the last model request’s input tokens and model
window. Tool-loop billing still sums all successful calls. Inspecting the meter
queries the live Pi session for current occupancy. Compaction or missing request
evidence falls back to Pi’s native reading at settlement. Codex measures
per-turn usage from thread totals relative to a pre-turn baseline so repeated
notifications do not add usage again. Missing usage or cost is left unknown.
See [AI Usage Records](./ai-usage-records.md#local-agent-observations) for storage,
display and gateway attribution.

## Structured questions

ACP `elicitation/create` form mode uses the AskUserQuestion composer. The request
must match the active connection and turn. URL mode is unsupported and requests
outside a conversation return `cancel`. Flat fields keep native IDs and types.
Users can review defaults and explicitly submit, decline or cancel. Renderer and
Main validate against the schema. Cancellation and shutdown release pending
questions.

Grok Build uses two native reverse requests. For `ask_user_question`, Cherry
returns the selected labels as an array for each answered question. A free-text
answer uses Grok’s `Other` choice and carries the text in the question’s notes.
The answer belongs to the open request. Submitting an expired card cannot start
another turn.

In a plan interview, **Discuss first** and **Skip interview and plan** are
available from the first question, including before any answer. Both respond to
the pending request with the selected action and the answers filled in so far.
Grok receives the selected labels for each answered question. A free-text-only
answer appears as `Other`; the draft text stays in the composer. Selecting the
last option leaves the interview open for the user’s decision.

For `exit_plan_mode`, approving the displayed plan returns `approved`. Denying
with written feedback returns `cancelled` with the feedback so Grok can revise
the plan. Denying without feedback or running unattended returns `abandoned`.

See [Adding a Runtime](./adding-a-runtime.md) and
[Agent Session Runtime](./agent-session-runtime.md) for the host contract.
