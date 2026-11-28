---
description: Local CLI agent configuration, native model ownership, protocol drivers, installation reuse, and compatibility verification
sources:
  - src/shared/ai/localAgentUsage.ts
  - src/shared/ai/localAgent.ts
  - src/shared/data/presets/localAgents.ts
  - src/shared/ai/localAgentModel.ts
  - src/shared/ai/agentPermissionMode.ts
  - src/shared/ai/agentSessionCost.ts
  - src/shared/ai/executionIdentity.ts
  - src/main/ai/runtime/LocalRuntimeDriver.ts
  - src/main/ai/runtime/acp
  - src/main/ai/runtime/cli
  - src/main/ai/runtime/claudeCode/LocalClaudeConnection.ts
  - src/main/ai/runtime/codex
  - src/main/ai/runtime/cursor
  - packages/agent-runtime-acp/src
  - packages/agent-runtime/src/cliLogin.ts
  - packages/agent-runtime/src/permissionMode.ts
  - packages/agent-runtime-amp-acp/src
  - packages/agent-runtime-antigravity-acp/src
  - packages/agent-runtime-claude-code/src/localLaunch.ts
  - packages/agent-runtime-codebuddy-acp/src/cli.ts
  - packages/agent-runtime-codex/src
  - packages/agent-runtime-cursor/src
  - packages/agent-runtime-deepagents-acp/src
  - packages/agent-runtime-deepseek-harness-acp/src
  - packages/agent-runtime-grok-acp/src
  - packages/agent-runtime-junie-acp/src
  - packages/agent-runtime-kiro-acp/src
  - packages/agent-runtime-vibe-acp/src
  - src/main/ai/agentSession/AgentSessionRuntimeService.ts
  - src/main/data/services/AgentProviderService.ts
  - src/main/data/db/schemas/agentProvider.ts
  - src/main/services/codeCli
  - src/main/services/LocalAgentAuthService.ts
  - src/main/services/localAgentCredentials.ts
  - src/main/ai/mcp/LocalAgentMcpBridgeService.ts
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
For a standalone item in the services list, Delete archives the Agent and its
active conversations and removes the item from the list. This includes custom ACP
Agents and saved records without a recognized preset. Restore archived items
from Settings → Archive.
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

- SQLite stores each configured connection in `agent_provider` and each local
  Agent's enablement, browser policy and default model in `agent_provider_binding`.
  The preset ID and user overrides are stored separately from the bundled catalog.
  Presets supply the protocol and launch defaults. A custom executable uses ACP. The Agent read
  model exposes the binding as `localRuntime`. Discovery, checks and session
  capability reads use IpcApi.
- The local settings and login commands encrypt credential environment values
  before writing them. Agent DataApi reads expose ordinary overrides. Saving a
  model or other binding policy uses the existing Agent DataApi.
- A session context keeps the provider through its backend. A new context uses
  the current Agent binding. Changing the launch target creates a new provider.
  Signing in updates the existing provider. Resuming an existing context uses the
  current credentials of its original provider. If the adapter confirms that the
  native thread cannot be restored, the next message continues in a replacement
  thread with reference history from the selected Cherry conversation branch.
- `AgentSessionRuntimeService` owns scheduling, approvals, persistence and disposal.
  Session opening, connection checks and model discovery use the same adapter
  table in `LocalRuntimeDriver`. The table loads the ACP, Cursor, Claude Code or
  Codex adapter on demand. Each adapter publishes shared runtime events. Each turn
  establishes a source in its session
  context before publishing addressed text, reasoning, plan and tool updates.
  Selecting an interactive ACP conversation in the active chat view opens or restores
  its production connection in the background once its workspace is known. Read-only
  history uses Cherry’s saved messages. The permission menu displays connection status
  until the formal connection reports its choices. A send or command request joins
  the same opening or restore.
  After the last interactive view leaves, a resumable idle connection is eligible for
  the normal idle timeout. Active execution retains its connection.
- CLI-backed adapters share executable and environment resolution in `runtime/cli`.
  The Code CLI service uses the same installation discovery. Runtime packages
  declare the native command rules, and Main provides the installed components,
  resolved environment, and platform operations.
- ACP chat and Settings use separate entries in `@cherrystudio/agent-runtime-acp/v1`.
  Chat binds prompt, configuration, cancel and close to the native session ID. Checks
  and sign-in only perform the handshake and the requested authentication. Model
  discovery opens a temporary session, reads its reported catalog and closes it when
  supported. Settings connections expose no host files, terminals or browser MCP.
  The ACP package owns the stdio process lifecycle for chat and Settings. Main
  supplies the platform spawn operation, releases desktop leases and reads history
  from Cherry's archive.
  For a harness with its own ACP adapter, settings and launch read its CLI declaration
  from the same package. Main binds desktop services in `acpPresets.ts`. The adapter
  translates the native model, permission and session formats it supports.
- Codex chat and Settings share the [Codex App Server launcher](../../../../packages/agent-runtime-codex/README.md).
  Main resolves the executable with the same component selection used by installation and passes
  the workspace, environment and cross-platform process operations. The Codex package assembles the
  stdio command and owns the launched server. Connection checks only initialize, and model discovery
  follows the catalog cursor. Chat opens or resumes the thread. Main supplies attachments and browser
  access, routes approval decisions and publishes incremental updates to the Cherry run.
- Local Claude Code and built-in Claude Code share the Claude Agent SDK session reader,
  incremental message projection and native history. Local sessions use the selected CLI,
  workspace and account configuration. When discovery finds no Claude CLI, Agent Services
  and Code CLI can use the verified executable already downloaded for the built-in
  Claude Agent SDK. The Claude runtime package derives SDK
  spawn options from that installation for both chat and Settings. Permission mode
  and effort apply to the current query. Settings reads the initialization catalog
  without sending a message or creating a transcript.
- Streams use `runtime:<agent-id>` as execution identity. It belongs to the stream.
  Persisted messages retain author and native model attribution when available.
- Cursor uses the bundled TypeScript SDK for login, model discovery and session recovery.
  In the Cursor agent settings, sign in through the browser or enter a Cursor API key.
  Cherry verifies the key before saving it as `CURSOR_API_KEY` in the local agent
  configuration. Model discovery and sessions use the configured key ahead of
  the shell environment and SDK browser credentials. A successful browser sign-in
  removes the key saved in the agent settings.
  The Agent stores the selected SDK model ID and passes it to both create and resume.
  Both use the session workspace as the SDK's local working directory. Cursor supplies the
  selected model's standard tools and enforces their native permissions, including file
  edits, deletion and shell execution. Cherry can supply a per-agent `CURSOR_API_KEY`.
  The native shell uses the SDK environment. Cherry requests Cursor Auto-review and passes
  the selected Agent or Plan mode with each turn. The optional browser MCP endpoint keeps its
  session-scoped lease. Recovery uses the SDK agent ID. [Cursor SDK documentation](https://cursor.com/docs/api/sdk/typescript)
- For CLI-backed routes the CLI owns authentication, project settings, MCP and Skills. Local turns use
  native resources and controls. Main rejects Cherry knowledge scopes for these turns.
- Native CLI login uses the shared stdio process capability. The desktop forwards
  device codes and login URLs. Each harness declares its account status command
  and output format.
- When host browser control is enabled, interactive sessions expose Cherry Studio's
  session-scoped built-in browser `automation` MCP (`LocalAgentMcpBridgeService`) over
  loopback Streamable HTTP with a per-session bearer token (or `stdioHttpMcpShim` when
  an ACP agent lacks HTTP MCP capability). Per-agent `browserControl` (`inherit`,
  `readonly`, or `disabled`, defaulting to `disabled` for custom ACP) and session mode
  (`plan` / `readOnly`) enforce read-only or disabled isolation; headless scheduled tasks
  and OpenClaw's ACP bridge (which rejects per-session `mcpServers`) omit browser
  injection, and injected `automation` tool calls auto-approve across Claude, Codex, and
  ACP when host control is allowed. The bundled Pi ACP bridge receives the MCP descriptor.
  Registering that descriptor with Pi on session creation and resume remains pending for `pi-acp@0.0.34`.

When the active connection binds a native steer, the session scheduler saves the input
against that connection's context before submitting it. Explicit refusal permits the
same input to fall back to the next turn. Missing receipts retain the original binding.
Codex confirms placement from its native user item echo. Stop withdraws input that
is still being prepared. When Grok starts its own follow-up, Cherry preserves the
order of its private turn events and standard ACP content.
Composer holds unsent drafts and sends native follow-ups directly when the current
connection offers a durable queue.

The Composer routes `/compact` to the connected runtime's standalone compaction
operation when available. Claude, built-in Pi and Pi Durable also accept instructions.
The operation reserves the session until it receives a matching native outcome.
Successful compaction refreshes context usage without creating a chat input.

### Models and configuration

Agent Services offers native models and Cherry models through the unified gateway.
For ACP, a native selection in Agent Services saves the Agent's launch preference.
The conversation picker shows configured gateway models while an ACP connection
opens. Native choices and switches use the active ACP session after it connects.
Adapters that expose their native catalog separately can load it when the session
only reports its current model.

A Cherry model default belongs to the Agent's provider binding. Selecting,
switching or clearing it writes no CLI file and neither starts nor enables the user-facing API
Gateway. Agent Services offers Cherry models only for presets with an entry in
the launch-binding table (`getLocalAgentLaunchBinding`) and for DeepAgents and
Junie. Factory Droid, Poolside, Hermes and MiniMax Code offer none.

Every process Cherry spawns for that Agent binds the model at spawn: chat
sessions, scheduled tasks and Cherry-launched terminals. Catalog, account and
sign-in probes run without a binding. Main resolves the model and obtains a
credential from the internal loopback gateway that authorizes only the chat
routes and that model, attributed to the session. The preset's binding then
hands the connection to the CLI without touching the user's files:

- Claude Code receives SDK flag settings in sessions and a private
  `--settings` file in terminals.
- Codex receives `-c` overrides that select a Cherry provider and read its key
  from the child environment.
- OpenCode and Kilo receive generated configuration through
  `OPENCODE_CONFIG_CONTENT` and `KILO_CONFIG_CONTENT`, merged into any value the
  Agent already passes.
- goose and GLM receive the generated connection as environment variables
  through their preset launch hook.
- The other presets get a per-launch overlay home behind their documented home
  variable. The shared configuration adapters render the CLI's files there from
  the user's current files plus the Cherry provider. Every other entry links to
  the user's home. When the launch ends, entries the CLI created move to the
  user's home, and files it replaced or deleted are applied only while the
  user's file is unchanged. Generated files are discarded.
  `LocalAgentOverlayService` reconciles overlays left by an abnormal exit at
  startup. A launch fails before writing anything when the home variable would
  leave a generated file outside the overlay, for example when
  `CLINE_DATA_DIR` overrides `CLINE_DIR`.

The credential and overlay are released when the session or task ends.
Terminals keep their binding until Cherry stops. DeepAgents and Junie apply the
Cherry model when the ACP connection opens. Junie reads a connection-local model
profile that references the credential through the child environment.

Claude Code and Codex native model selections are Cherry chat overrides.
Use native configuration clears the override and lets the runtime resolve the
model for the next connection. Claude's native Default entry remains a selectable
model alias. Cursor displays its `auto` and `default` aliases as one Auto option.
An Agent without a model override uses Auto. The separate Cursor Router
(`auto-smart`) retains its catalog entry.

Requests that use the public gateway key keep their provider usage records with
no session association.

For Grok Build, a Cherry model also binds the native `session_summary` and
`prompt_suggestion` roles. User-pinned roles keep their own model. The launch
credential also authorizes the dedicated summary Chat Completions endpoint,
including when the primary conversation uses Responses.

Without a Cherry chat override, new chats, terminal sessions and managed WebUIs use the native default. Model
arguments, environment and project settings can override it. Open sessions keep
their current model. Newly opened ACP sessions apply the saved Agent preference
when supported. On restore, an ordinary Agent preference leaves the native
current model in effect when the runtime reports one. A Cherry model binding
applies its model.
Presets without an applicable model control follow their CLI default.

Presets with native files use the shared **CLI configuration files** editor,
which opens without a Cherry model selection. DeepAgents instead uses launch
arguments and environment. DeepSeek Harness and Hermes require their managed
service to stop before editing. Raw edits retain native file formats, check for
concurrent edits and synchronize only Agents using the same configuration root.
They never change an Agent's Cherry model selection.

### WebUI and managed gateways

The WebUI start/stop control manages a Cherry-owned process. **Open WebUI** opens
the running service in a separate action. External services are open-only.

- OpenClaw pairs a native Gateway with its ACP bridge. Chat leases share the
  Gateway and keep it alive until the last lease closes. Explicit WebUI use
  retains the service. Cherry reuses healthy external Gateways and stops only
  process trees it owns. Explicit Gateway URLs and native state/config overrides
  bypass automatic management. Password sign-in uses OpenClaw's own page. Token
  sign-in can use a Dashboard bootstrap.
- OpenClaw uses the selected model from its managed configuration. The Cherry
  gateway option writes no provider or credential to `openclaw.json`. Each
  Cherry-owned Gateway reads a private copy of that file with the gateway
  provider and a credential scoped to its process, released when it exits.
  Changing the gateway model restarts the Gateway. On exit, Cherry removes
  scoped entries from OpenClaw's `agents/*/agent/models.json` cache and copies
  config edits made through OpenClaw back to `openclaw.json`, unless that file
  changed meanwhile. Use this option while Cherry is running; requests record
  provider usage. User-edited
  conversation names take precedence over bridge UUIDs and technical titles. Cherry
  prefers `session/load` because the bridge may lose UUID mappings across restarts.
  Native database failures surface `openclaw doctor --fix` guidance.
- DeepSeek Harness uses `dsh --profile acp`. The managed ACP, WebUI and headless
  profiles share the home `cordis.patch.yml`. Retained catalogs support resuming
  sessions after `settings.yaml` migrates. Credentials, settings and profile
  patches share write and rollback checks. Explicit `DSH_HOME` uses its own
  profile. Managed tasks connect on first send, so the model remains editable
  until then.
- A DeepSeek Harness gateway selection writes no route or credential to the
  DSH home. Each WebUI or ACP process gets a `--patch` overlay rendered from the
  user's current files and a credential scoped to that process, or to its
  session for ACP, released when the process exits. Only an explicitly chosen
  agent preset is written to `settings.yaml`. A gateway model needs the default
  ACP profile. Direct provider selections still write the DSH home.

## Installation and connection

The [preset catalog](../../../../src/shared/data/presets/localAgents.ts) and
[installation recipes](../../../../src/main/services/codeCli/installRecipe.ts)
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
  Version checks include installations below the runtime's ACP minimum. A newer
  package release is shown even when the active package manager cannot upgrade
  the detected executable in place.
  Existing mise installations can be reused and removed. See
  [BinaryManager discovery rules](../binary-manager/README.md).
- CodeBuddy installs its published `@tencent-ai/codebuddy-code` package and uses
  its `--acp` entry point. The Pi package assembles the bundled bridge command with
  the installed `pi` executable. Pi terminal sign-in uses `pi` directly. OMP requires
  Bun 1.4.4 or newer. Amp chat requires both `amp-acp` and `amp`. Amp terminal,
  CLI sign-in, and subscription usage use `amp` directly. ZCode requires a separate native executable.
  The [DimAgent package](../../../../packages/agent-runtime-dimcode-acp/src/cli.ts)
  declares the `dimcode` npm distribution and the `dim acp` command.
  Sign in with `dim auth login`. Configure a custom model provider in the
  native terminal with `/connect`.
  Muse Code installs the official binary for the host platform from the ACP
  Registry and runs `muse acp` with the runtime's ACP flag. Sign in from Settings
  by confirming the device sign-in link, run `muse login` in a terminal, or
  provide `META_API_KEY`.
  Antigravity requires the official CLI with ACP support (v1.5.0 or later).
  Chat, connection checks and model discovery use `agy acp`. DeepAgents checks its Anthropic
  and OpenAI provider packages even when reusing its adapter. Kiro supplies
  its official installer and executable identity. Mistral Vibe supplies its
  `uv` install plan. Installation fails
  if a required dependency is missing after setup.
- Upgrades keep old managed resources for running terminals. Uninstall rechecks
  the confirmed installation and ownership of each component, verifies removal
  and reports partial failures. Shared runtimes, credentials, settings and
  conversations are preserved. Source-installed Hermes uses its native updater
  and data-preserving uninstaller. Installations with unverified ownership leave
  running sessions and WebUIs open and require the original installer or manual cleanup.

Passive discovery never starts the CLI. Check/enable performs a bounded handshake
without prompting the model or starting login. Discovery reports the installed
CLI version. A failed or incomplete discovery keeps the last known availability
visible. Retry checks availability again. The directory offers installation once
discovery confirms that the CLI is absent. The handshake reports the version
supplied by the protocol peer.
`protocolInfo` records handshake,
session and prompt stages as each succeeds. Available tools, controls and resume
behavior depend on the connected CLI. Authentication and known timeouts have
separate recovery flows. An incompatible managed CLI can be kept alongside a
system install.

Terminal launch uses the native interactive command with a selected directory and
terminal application. Agents share the last launch directory and removable recent
directories. Each tool remembers its own terminal application.
A missing directory blocks launch. macOS starts terminals through an owner-only
script that removes itself before running the CLI. Failure, shutdown and expiry
clean up unused scripts.

### CLI sign-in

Agent Services reads the native account where the runtime supports an account
query. It repeats the query after sign-in and when the window regains focus. The
account menu shows any identity or workspace returned by the runtime.
Antigravity uses a successful authenticated live session as its sign-in signal.

The sign-in dialog offers the runtime's supported CLI and ACP flows, then
refreshes the catalog on success. The CLI owns its native credentials. Cherry
saves environment overrides explicitly entered for the selected Agent. A
credential that belongs to a model provider is configured through that provider.
Qoder and Qoder CN each use their own installation and account.
TRAE CN signs in through `traecli login`. TRAE CLI 2.0 requires the TRAE
Enterprise Flagship plan. Copilot, Command Code, and Auggie use their native
terminal login commands. MiniMax waits for `mcode login` to complete. Vibe
checks the active credential through its ACP status operation. ZCode signs in
through the native CLI selected by the bridge.
Antigravity can sign in from the terminal with `agy acp --login` and reuses the
CLI's saved credentials in ACP sessions. Explicit overrides retain their command.

Login prompts are sent to the window that started the request. The five-minute timeout, cancellation, program changes, panel closure and app
shutdown release the owned login process. Late results cannot save credentials or
report success. A failed post-login catalog refresh is shown on the Agent card
and can be retried. Errors from a Cherry gateway provider retain that provider's
recovery link.

### Subscription usage

Agent Services shows account identity and login actions for the selected provider.
Session Details reads quota when opened or refreshed if the session's effective
provider and route support it. It displays the
windows and balances supplied by the account adapter. When the adapter reports
model groups, each group has one heading above its quota windows.
Cursor reads the plan and current billing period using the Agent's effective SDK
credential. Browser sign-in uses the SDK's existing saved login. The quota reader
uses Cursor's production account service and discards results if the login changes.
Amp reads its native balance command. Factory reads billing limits
with a configured Factory key. OpenCode Go uses the installed CLI's active
service account key when a Go model is selected.
Muse Code reads its native usage command on supported versions. Kiro reads the
active browser session's credits without opening a chat or refreshing credentials.
MiniMax Code reads Token Plan quota with the official API key for the live model.
Qwen Code's console quota commands require a separately authenticated console account.

The probe checks the selected account without sending model input. Some CLI
versions and account routes lack a supported quota source. Cherry gateway models
use their provider's account. Conversation statistics continue to show turn usage.

## Protocol behavior

| Driver | Resume identity | Model control | Approval protocol |
| --- | --- | --- | --- |
| Claude Code | SDK session ID | SDK model catalog or CLI default | SDK `canUseTool` |
| Cursor SDK | Local SDK agent ID | SDK model catalog or Auto | Cursor native tool permissions and Auto-review when available |
| Codex | App Server thread ID | `model/list` or CLI default | Native decisions and permission requests |
| ACP | ACP session ID | Model config option or legacy `session/set_model` | Original option IDs and scopes |

### Session controls

ACP `configOptions`, including an empty list, takes precedence over legacy modes.
If the agent advertises new controls during a legacy mode change, its update stays
authoritative when the pending `session/set_mode` request completes.
Model config options similarly take precedence over the legacy model interface.
Unknown option types are ignored. Known labels are localized and native IDs and
custom text are preserved. A model absent from a non-empty catalog fails
explicitly. For Qwen, MiniMax and Hermes, Cherry maps provider-configured defaults
to advertised ACP IDs. CLIs with config-file-only model selection use the
configured default.

The Settings picker reads the installed runtime's catalog. The ACP Composer
shows connection status until the native session applies its initial
configuration. It then reads and writes models through that session's model
control. Standard ACP configuration responses or updates confirm the new
model and its effort. A successful legacy setter acknowledges the requested
model. The Composer distinguishes missing authentication, an empty catalog,
a single current model and an unavailable model operation.

Codex uses paginated `model/list`, Claude reads SDK initialization, Cursor uses
`Cursor.models.list()`, and Grok uses `_x.ai/models/list` when available. Ordinary
ACP opens a dedicated probe session and reads the advertised model selector or
legacy model list. Each catalog entry carries its own advertised effort choices.
A standard ACP probe can associate `thought_level` with the reported current
model. Pi ACP's legacy thinking modes follow the same rule.

Ordinary ACP conversations need a live connection to discover permission choices.
The permission menu, Plan Only, and Shift+Tab save the same Agent configuration
field, `permission_mode`. A session maps that setting to its own supported native
choices before it admits a new turn. When several native choices map to one level,
the first advertised match represents that level. Idle connections apply changes
immediately. A running local turn uses its current permission until the next turn.

The connection publishes its confirmed native permission, effort, and other
configuration controls. Cursor reads the active model's effort parameter from
the SDK catalog and applies it on the next send. ACP uses its advertised effort
options. Pi ACP also accepts its legacy thinking modes, and Grok can set effort
on a model reported by its legacy catalog. A reconnect validates saved effort
against the live control and model before applying it.

Full Access requires confirmation. Shift+Tab toggles the advertised Plan or
read-only mode and exits to a safe working mode. Prompt suggestions stay disabled
while the Agent configuration or the live session requires Plan mode.

### Approval and content

- Codex approval requests can inherit command, directory and file-change details
  from the matching item. Request fields take precedence. Item completion or the
  next turn clears those details. Codex retains the specific permissions granted
  for a session. Further permission requests require another decision.
- ACP tools merge updates by native call ID. Standalone approval cards settle
  independently. Client file writes require approval. A delegated terminal creation
  needs its own approval or an explicit session grant under the default policy.
- The Antigravity adapter interprets question requests, warning metadata and
  session-scoped approval options. Main owns the approval lifecycle and records
  Cherry grants. Selecting Cherry's session grant replies with the offered
  native one-time approval ID.
- Runtime packages declare permission choice semantics and application timing.
  Claude and standard ACP controls update the live session. Codex and Cursor
  apply their selection on the next turn. DeepSeek Harness applies it at launch,
  so changing it closes the idle connection and the next open uses the saved
  value.
- The ACP adapter annotates the session's actual choices. The Composer uses
  those annotations for its permission menu, risk confirmation and Plan
  shortcut. Separate sandbox controls appear in the permission menu. Other
  live controls appear under Agent settings in the input QuickPanel. Model
  defaults belong in Agent Services. A label can trigger a risk confirmation but cannot
  authorize a host operation.
  Terminals are connection-owned and working directories provide no OS isolation.
  A command path with spaces runs directly when it resolves to an executable.
  A legacy command string without an argument array can run as approved shell input.
- ACP sessions without a verified approval control or multiple verified approval choices use Cherry's shared
  permission menu for Ask Before Acting, Auto-accept Edits, and Full Access. Cherry
  saves the choice on the Agent. Auto-accept Edits covers writes within the
  workspace. Full Access selects native single-use approvals when available and
  skips Cherry's delegated file and terminal confirmations. Native restrictions,
  read-only mode, structured questions and unattended execution keep their own policies.
  When an ACP harness exposes a verified Plan and a default working mode,
  Plan Only in the input quick panel and Shift+Tab switch between native Plan and the working mode.
- Copilot exposes separate workflow and approval controls. The permission menu
  changes `allow_all`, and Plan Only changes the workflow. Junie exposes
  `brave_mode` and a separate workflow. Kiro maps Supervised to the default
  permission level and Autopilot to Auto. Cline exposes a session boolean for tool
  auto-approval alongside Act and Plan. Antigravity uses the approval choices
  advertised by the active session. MiniMax's process-scoped
  `permissionMode` setter writes CLI configuration. Cherry excludes that setter
  from session controls and retains the native legacy Plan selector.
  Antigravity, Grok Build, and Oh My Pi expose launch-time bypass through the same menu.
  Cline uses its launch flag as a fallback when its native approval control is
  unavailable. A session that requires launch bypass restarts its process with
  the Agent's selected permission and restores the native conversation. Entering
  Plan removes the flag before restoring. Cherry leaves the CLI configuration
  files intact. Explicit custom arguments keep their own policy.
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
Cursor uses the last completed model call for context occupancy and the SDK
run totals for billing. A context reading may contain only the token count.
The window comes from the native runtime or an exactly bound Cherry model
in the provider catalog.
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
