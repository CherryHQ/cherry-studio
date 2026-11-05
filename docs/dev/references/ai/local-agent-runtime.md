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

Agent Services manages local Agent installation, models and advanced
configuration. Model selection offers native Agent models and Cherry models through
the unified gateway. Direct provider selection is not offered. Selecting a model applies its connection and native default for
both chat and terminal use; there is no separate provider configuration panel.
The Agent Services launchpad and sidebar shortcuts open Settings → Agent Services,
the sole manager for installation, model selection and CLI configuration.
Legacy `/app/code` links and saved tabs redirect to settings, preserve the selected
Agent, and reuse the existing settings tab.
WebUI controls separate service lifetime from navigation. One icon button to the
left of Terminal starts or stops a Cherry-owned service, with a tooltip for the
current action. Starting only runs the background process; once running, a separate
**Open WebUI** button opens its page. Externally owned services remain open-only. OpenClaw preserves native password
authentication and opens its native sign-in page; only token authentication uses a
Dashboard token bootstrap.

All presets with native configuration files use the same **CLI configuration files**
editor, including DeepSeek Harness, Oh My Pi, Snow, ZCode and GLM Agent. It opens
without a selected Cherry model and does not replace file access with a provider
or model dialog. DeepAgents uses its runtime arguments and environment settings;
no native configuration file is invented for it.

DeepSeek Harness exposes `settings.yaml`, the default, headless and ACP
`cordis.patch.yml` profiles, and `.credentials.yaml` under its registered `~/.dsh`
home. Profile YAML retains its sequence root and native tags. Raw saves reuse the
service mutex, native file locks, snapshot conflict checks, owner-only atomic
writes and rollback. DeepSeek Harness and Hermes require their managed service
to stop before editing, with the stop action in the same editor. Model selection immediately applies Cherry-managed connection defaults, including
DeepSeek Harness profiles, without starting its WebUI. Global raw edits synchronize
only Agents whose configuration environment matches the global CLI root; unrelated native settings
and files remain user-owned.

OpenClaw connects through `openclaw acp` to its local Gateway and uses the shared
enable, archive and chat controls. It retains its Agent Services model list, native
configuration entry and WebUI actions. Its configuration button opens the shared
file editor for `~/.openclaw/openclaw.json` without requiring a selected Cherry
model. Raw edits use the same Gateway write lock as model synchronization, with
snapshot conflict checks and atomic owner-only writes. Saved credentials are
reloaded before the next dashboard or ACP connection. Selecting a model synchronizes the native
default immediately; a failed write rolls back the Cherry selection. Chat follows
that default because the bridge does not expose ACP model selection.

ACP connections share a Gateway lease. The last connection stops a Gateway started
for chat unless the service was explicitly started or its WebUI opened. Healthy external Gateways are
reused and never terminated by Cherry. Stopping an owned Gateway targets its child
process tree only; active chat leases defer WebUI shutdown. New sessions use
isolated bridge keys and persist the selected working directory and native resume
ID. Explicit Gateway URLs or native state/config overrides bypass automatic local
Gateway management. Gateway credentials are passed through the child environment,
not process arguments. Native database migration failures show a localized
`openclaw doctor --fix` instruction; Cherry does not run that repair automatically.

OpenClaw Cherry-model selections write a stable Cherry API gateway URL and key to
its native configuration; upstream provider secrets stay in Cherry. Terminal, ACP
and WebUI use the same gateway-backed default. Cherry must be running to serve it.
Native Gateway authentication and non-Cherry provider settings are preserved.
ACP prompts disable OpenClaw's working-directory text prefix while retaining the
session cwd. Technical bridge IDs and directory-prefixed titles do not override
conversation names. Existing technical titles are automatically named on the next
submitted turn; manually edited names are preserved.

OpenClaw 2026.10.2 advertises `session/resume` but does not resolve a bridge-created
UUID from its persisted ledger after process restart. Cherry prefers its official
`session/load` when available, preserving the UUID and suppressing replayed output
already stored by Cherry. Failed loads retain history and never create a replacement
session. The missing UUID lookup in upstream `resumeSession` remains an OpenClaw
limitation.

The installed OpenClaw bridge determines support for tools, approvals, session
controls and resume. Per-session MCP injection, client filesystem and terminal
callbacks are not supported by the bridge. Native Gateway/Agent configuration
continues to own those capabilities.
DeepSeek Harness connects through `dsh --profile acp` and uses the shared enable,
archive and chat controls, native file editor, model list and WebUI actions. New ACP connections apply the selected Agent Services model using
the same native settings and credentials as the WebUI. The ACP profile override is
written and rolled back with the existing configuration transaction, preserving
unrelated user entries. Disabling or uninstalling also stops its managed WebUI.
Chat follows this managed model selection; global switching from the chat picker
is not supported. Protocol features depend on the installed CLI: 0.2.1-rc.5 sends
committed assistant output and supports model/reasoning options, approvals and
resume, without mode, command, plan, client file/terminal or elicitation callbacks.

Interactive terminal actions open the shared Agent Services launch dialog to select a
working directory and terminal application. Choices are saved per tool in
`feature.code_cli.configs`, reusing existing Agent Services keys and using preset IDs
for ACP-only tools. A per-tool recent-directory dropdown supports selection and
removing history entries without changing files on disk. Launching moves the selected
directory to the front; removing an entry saves immediately. The selected directory is checked before launch; an unavailable
directory is reported rather than silently replaced with the user's home directory.

Enabling a local CLI creates a persistent agent. Each preset has one stable agent ID; custom ACP configurations have
independent IDs. Disabling asks for confirmation, archives the agent and its active
conversations, and stops its managed WebUI. Running tasks must stop before the
existing archive operation can proceed. Cancelling or failing to archive leaves the
agent active. The manager keeps archived local agents visible with their configuration
read-only. Enabling restores the original agent ID, configuration, ordering, and
conversations archived with it; independently archived conversations stay archived.
Archived data follows Settings → Archive retention, so permanent removal ends this
restore path. No Cherry model
provider is required. “Local” refers to the CLI process, not an offline model.

## Ownership and routing

- Agent configuration is SQLite business data under `configuration.localRuntime`.
  Detection, connection checks, and session capability reads use IpcApi. Updates
  merge individual `localRuntime` fields inside the database transaction. Omitted
  fields keep their latest values; explicit `undefined` clears an optional field.
  Advanced settings never resubmit model or enablement snapshots.
- Stream execution identities use `runtime:<agent-id>`; this is never stored as a
  provider/model foreign key. Message snapshots retain the author and native model
  identifier when reported by the CLI.
- `AgentSessionRuntimeService` owns turn scheduling, approvals, persistence and
  connection disposal. The local driver maps ACP, Claude Agent SDK, and Codex
  App Server into the existing runtime event contract.
- The CLI owns authentication, project settings, MCP and Skills. Selecting a native
  model writes its default configuration and the Agent record together; failure
  restores the file. Gateway selections retain their Cherry model identity separately from the native
  model identifier. Switching back removes injected gateway credentials while
  preserving tool settings. Stale drafts are rejected before writing any files.
  Existing direct-provider CLI configurations are not rewritten automatically;
  their current model appears under native models. Choosing another model or
  following the CLI clears the previous Cherry-managed provider configuration.
  No Cherry prompts, knowledge bases or tools are injected.
- Native default persistence currently supports Claude, Codex, OpenCode, Qwen,
  Kimi, Pi, Hermes, MiniMax, CodeBuddy, Kilo, Factory Droid, Mistral Vibe and
  GitHub Copilot. Other presets and custom ACP agents show an explicit
  limitation instead of claiming a session-only change is global. Defaults apply
  to newly started CLI sessions, including manual terminal launches. Explicit
  model arguments, environment overrides and project settings can take precedence.
  Existing interactive CLI sessions are not forcibly switched.
- Kilo shares OpenCode's provider configuration format. Droid uses `customModels`
  and `sessionDefaultSettings.model`; Vibe uses model aliases in `config.toml`
  with a Cherry-owned key in `.env`; Copilot uses `providers.json` and
  `settings.json`, leaving its internal `config.json` untouched. Switching back
  removes only Cherry-owned providers, models and credentials. Droid's ACP mode
  still requires Factory account authentication even when a custom model is configured.
- A new local task defaults to its own managed directory. An empty task can select
  an existing project; sending its first message locks the agent and directory.
  Missing user directories are reported rather than created.

## Additional ACP presets

Executable names, launch arguments and packages are defined by the code-owned
[preset catalog](../../../../src/shared/ai/localAgent.ts) and
[installation recipes](../../../../src/main/ai/runtime/localAgent/installRecipe.ts).
Oh My Pi requires system Bun; Snow and the ZCode adapter require their documented
Node.js runtime. ZCode also requires a separate native backend.

These presets use explicit published npm packages because they are absent from
our ACP registry snapshot. Installation, upgrade and uninstall reuse the existing
system-package lifecycle and ownership checks without requiring the registry.
Missing system Bun is installed through global npm before installing omp. Terminal actions start the interactive CLI without ACP arguments. ZCode uses the
adapter's interactive CLI, which discovers the native ZCode backend itself; its
help link documents backend discovery and `ZCODE_BIN` overrides. Installing or
uninstalling the adapter does not install or remove the ZCode desktop app.

Cherry supplies `ZCODE_ACP_MODE=build` rather than the adapter's unrestricted
default. User environment overrides and the adapter's own configuration retain
their documented precedence. ACP model and configuration controls depend on what
the connected version returns. Snow currently provides no model selection through
ACP; it follows its CLI profile. No new global-model writer is implied by these
presets. Existing user credentials remain owned by each CLI.

Snow's recovery acknowledgment does not guarantee context recall after a process restart.
ZCode requires a working native backend; a successful lazy session creation does not
prove that its backend or credentials can serve a prompt.

Icon artwork is sourced from [Magpie](https://github.com/yetone/magpie/tree/63ad2b7c76ef57a02d3ca025a760a9d610ae5b74/internal/gui/assets/icons).
Protocol implementations: [omp](https://github.com/can1357/oh-my-pi),
[Snow](https://github.com/MayDay-wpf/snow-cli), and
[ZCode adapter](https://github.com/william0wang/zcode-acp).

## Installation and connection

Explicit executable overrides take precedence. Agent Services CLIs prefer a system
installation over an existing managed copy; other ACP presets retain their
existing installation discovery order. Explicit paths fail without fallback. Every connection
resolves installation facts again, so upgrades do not pin an old version path.
Managed installations use the shared binary execution environment; system CLIs
retain the user's shell environment. Explicit environment overrides apply last and
also participate in executable-name lookup. Windows environment names are matched
without case sensitivity, including native configuration-directory overrides.

New Agent Services installations, upgrades and lazy terminal installations use the
system installer shared with Agent Services: global npm packages, `uv tool install`
for Python tools, and official system installers for Antigravity and Hermes.
ACP-only distributions still use registry recipes and user-directory binary
installation. Package managers redirected into Cherry-managed directories are
rejected. Existing mise installations remain discoverable and removable; no
new Agent Services CLI is installed through mise. Hermes uses the official POSIX or
PowerShell source installer in noninteractive mode, without requiring a registry entry
or a preinstalled Python, uv, Node.js or npm. The installer prepares its dependencies;
existing Hermes installations are reused. Source-install upgrades use `hermes update`,
not PyPI package versions. Only verified legacy uv/mise installations support automatic
removal; source installations require manual removal to preserve their shared user data.
Kiro and Trae use their official installers on supported platforms; Vibe uses
`uv tool install mistral-vibe`, avoiding unsupported registry archive entries.
Install and reuse both check separate native CLI dependencies: Pi requires `pi`,
Amp requires `amp`, and Antigravity's terminal entry requires `agy`. Existing system
or Agent Services installations are reused; missing CLIs use the shared system installer.
An adapter alone does not satisfy these installation checks. Dependency failures
prevent an installation-success result. Adapter and terminal launches include the
resolved dependency directories, including Bun for OMP, without replacing the user's
home or explicit environment overrides. Terminal repair uses the same Agent installer.
System discovery follows the [BinaryManager exclusions](../binary-manager/README.md).
OMP requires Bun 1.4.4 or newer. Runtime resolution prefers a compatible system
installation over the bundled runtime and validates the version before reusing it;
installation does not report success if the runtime remains incompatible.
macOS terminals receive a short script path instead of inline environment values.
The owner-only script is sourced in the terminal shell and removes itself before
running the CLI. Launch failure, service shutdown, and a ten-minute expiry clean up
scripts that have not been consumed. Terminal.app opens a new window for each launch.
DeepAgents checks the Anthropic
and OpenAI model packages even when reusing an existing adapter; package discovery
uses filesystem facts so a prior failed module lookup cannot hide a newly installed
package.
Binary upgrades retain prior resources for running terminal processes and record
their ownership. Explicit uninstall removes the current bundle and verified recorded
versions; unrecorded legacy directories are not deleted. Uninstall confirmation lists
both the adapter and any separately installed native CLI, including their paths. The
component list is checked again after confirmation. Every component must pass its
installation ownership check before removal starts. Each command is followed by
verification that the program and its package directory are gone; partial failures
identify the components removed and those still requiring cleanup. Other installations,
shared runtimes, model packages, credentials, settings and conversations are retained.
Antigravity and standalone Kiro binaries in their default user installation locations
are removed only after checking their identity and rejecting symlinked programs.
Other script installations, including Trae's multi-directory layout, require their
original installer or manual removal when ownership cannot be verified.

Passive discovery queries BinaryManager without starting an agent. Check/enable
starts a bounded protocol handshake with no model prompt or automatic login.
Handshake success does not prove credentials or model availability. Native CLI
configuration errors remain visible during the first real request. A saved ACP model
missing from a non-empty current catalog is rejected before a model-change request;
Cherry asks for a new selection rather than silently switching models.

DeepSeek Harness writes shared provider routes, retained model catalogs and the
`agent-default-model` override to the home `cordis.patch.yml`, so ACP, WebUI and
headless profiles use the same selection. Managed catalogs already migrated into
the ACP profile are preserved in this shared layer. Legacy `settings.yaml` is still
updated, but its removal by DSH's native migration does not discard models needed
to resume older sessions. A new credential store uses `version: 1`
and `refs`. The headless profile restores the official credential, authorization and
account readers, so saved credentials take precedence over environment fallbacks.
Credentials, settings, home, ACP and headless patches are locked and restored together;
rollback refuses to overwrite any subsequent user edit.

Startup arguments are arrays, never shell strings. Environment overrides are
stored as user configuration; request logs and DataApi devtools redact local
arguments and environment values. CLI credentials are neither scanned nor copied.

## Protocol behavior

| Driver | Session identity | Model selection | Permissions |
|---|---|---|---|
| Claude Code | SDK native session ID | SDK model catalog, CLI default otherwise | SDK `canUseTool` requests |
| Codex | App Server thread ID | `model/list`, CLI default otherwise | Native decisions and permission requests |
| ACP | ACP session ID | Model config option, with legacy `models` / `session/set_model` fallback | Original option IDs and scopes |

Codex command/file approvals retain the matching `item/started` details, including
commands, working directories and proposed file changes. Approval request fields
take precedence. Details expire on item completion or the next turn; requests
without a matching item still use their own parameters.

ACP declares implemented text-file and terminal callbacks. Writes and terminal
creation require user approval; terminals belong to their connection. Working
directories are not OS sandboxes. Argument arrays execute literally. For compatibility,
a terminal command containing whitespace and no argument array may run as the
approved shell command only when the entire string does not resolve to an executable.
Existing executable paths with spaces remain direct launches. Spawn errors are
included in terminal output. ACP replay during session loading is suppressed
because Cherry already owns the displayed transcript.

During session creation/loading, command and configuration notifications are buffered
and applied only to the matching native session. Transcript/tool replay is not
rendered again. Modern model configuration takes precedence when both model
interfaces are advertised; a failed model selection is not silently ignored.

Connection checks expose `protocolInfo`: protocol version, reported agent identity,
advertised capabilities and completed verification
stages. A handshake-only check records only `handshake`; a live session adds
`session`, then `prompt` after a protocol prompt response. These stages do not
certify tool execution, cancellation or recovery, and are not persisted as a
blanket compatibility claim. Logs contain agent identity/version, not credentials.

ACP stop reasons map to stream finish reasons: `end_turn` → `stop`,
`max_tokens` / `max_turn_requests` → `length`, and `refusal` → `content-filter`.
`cancelled` uses the stream cancellation path and persists a paused turn. Limit
and refusal reasons are preserved in the stream; the existing shared message
status still describes completion of the stream, not completion of the user's task.

ACP `thought_level` select options use the unified Agent configuration menu. Known
levels reuse the translated labels of provider models; custom values
retain their native names and IDs. Fixed single-value options are not shown as
adjustable controls. Changes apply to the current native session, not the global
Agent. The UI updates on confirmed protocol state and does not invent a default
option. Pending changes settle before the next prompt; running turns cannot be
reconfigured through this control.

ACP session modes localize recognized names and descriptions in the composer while
preserving custom text and native IDs. When `configOptions` is provided, including
an empty list, it takes precedence over legacy `modes` / `session/set_mode`. Legacy
modes are used only when configuration options are omitted or null.
Configuration labels, descriptions, choice groups and recognized values follow the
interface language. Model names, model groups and unknown custom text remain native.
The complete configuration snapshot retains native categories and priority order;
unknown option types are ignored. Model parameters (`model_config`) appear in the
model picker and remain session-owned. Model selection continues to save the global
CLI default. Confirmed snapshots replace removed options and model catalogs.
Mode and reasoning changes share an in-flight guard; confirmed notifications refresh
the controls, and failed requests preserve the last confirmed value. Modes remain
session-owned and do not change Cherry's permission policy or the global Agent.

ACP thought chunks become ordinary reasoning parts, closing at text/tool/plan
boundaries, native message ID changes and turn completion. Text and reasoning
parts retain an optional native `messageId` in `providerMetadata.acp.messageId`;
other ACP content retains it in `data-acp-content.data.messageId`. Missing or null
IDs do not inherit a preceding ID. A native message can span several parts, while
Cherry message UUIDs and the existing JSON storage remain unchanged. Native IDs
are attribution, not global deduplication or replay keys.
Plans use a dedicated `data-agent-plan` message
part; full snapshots replace the same per-turn part and reuse the task-list view.
They are not synthetic tool calls. Loading native history suppresses both thoughts
and plans to avoid duplicating Cherry's persisted transcript.

Tool updates merge native status, input/output, content and locations by call ID.
Programmatic tool names are stored separately from readable titles; omitted or
null names preserve the previous name during updates. Null location lines mean
no specific line and retain the normal tool disclosure.
The tool disclosure renders text, file diffs, file links with reported line numbers,
and snapshots of client-owned terminal output. Unrecognized content retains a raw
fallback. File locations with a positive one-based line open read-only source
preview, scroll to that line and highlight it briefly. Repeated locations reuse the
same file view; without an embedded file panel they reuse a file preview tab.
Missing or invalid lines retain normal opening behavior. Stored
terminal snapshots remain readable after process release.

Enabled local sessions prewarm on opening so their options are available before
the first message. Config notifications refresh the controls, including when a model
change removes thought levels. On reconnect, native session configuration is the
source of truth: Cherry does not reselect an already-matching model and thereby
reset the restored effort. Persistence of unused settings depends on the CLI; Cherry
does not store a second copy of native thought settings.

The composer remembers up to 100 sessions' configuration display snapshots in
renderer memory. Returning to a session shows its previous options immediately;
changes stay disabled until live session information arrives. Cached snapshots do
not enable attachment capabilities. A single configurable item opens its choices
directly and shows its name and current value in the trigger; multiple items use
submenus. Starting or ending generation does not clear the configuration display.

Tools merge by native call ID. Standalone permission IDs settle their own cards.
Approval previews reuse cached ACP tool titles and inputs when the permission
request contains only its call ID; protocol option wrappers remain hidden.
Unknown tool results use generic cards. Missing token/cost/model data is not
invented. Images and model controls use connected capabilities; native slash
commands populate the existing command menu.

Gateway sign-in failures retain the upstream provider identity through ACP error
wrapping. The chat shows localized sign-in guidance and opens that provider's
model settings, rather than the local Agent's login page. Raw diagnostics remain
available in error details.
Known native provider-adapter and model-catalog failures use localized diagnostics
without calling a diagnosis model or treating them as missing Cherry models.

ACP `session/prompt.usage` is stored as a typed, Main-authored
`agent_session_message.data.localTurnUsage` turn summary. It does not create a
synthetic invocation. Message details and Settings > Usage display it separately
from provider calls, including historical synthetic local summaries. Main strips
renderer-authored values and forks drop the original turn's observation. See
[AI Usage Records](./ai-usage-records.md#local-agent-observations) for gateway
correlation and counting boundaries.

ACP `usage_update.cost` is a cumulative native-session snapshot. The usage details
show its original currency and latest reported amount, including an explicit zero;
missing costs stay hidden and tiny positive costs are not rounded to zero. Updates
replace the previous amount rather than adding to it. They do not create
`ai_usage_record` entries or contribute to per-message billing totals.

Main stores the typed snapshot in existing `agent_session_message.data.localSessionCost`
JSON, with the native session ID and report time. Shared cache supplies live updates;
`GET /agent-sessions/:sessionId/cost` reads history without starting the CLI. The
snapshot survives connection release and app restarts. A new native session records
an unknown-cost marker, preventing the preceding session's amount from reappearing.
Forked history does not inherit this snapshot. Before any message exists, the value
is runtime-only and is attached when the first assistant reply is persisted.
Renderer message writes cannot overwrite Main-authored snapshots.

ACP image attachments send base64 content only when the agent advertises image
input; unsupported images fail explicitly instead of becoming path text. Agent-wide
image support does not guarantee that its currently selected model supports vision.
File attachments use `resource_link` with an encoded file URI, original display name,
MIME type and size. Agents advertising `embeddedContext` receive `resource` content
instead: UTF-8 text for text/code files and base64 blobs for binary documents.
Managed attachments resolve through FileManager; missing files fail before sending
a prompt. File references remain subject to the CLI's native access permissions.

Stop first requests protocol cancellation, then closes the owned process tree if
necessary. Pending approvals resolve as denied/cancelled. Process failures retain
received output and do not replay a turn. Nested ACP error details are retained and
redacted; missing model/key configuration gets localized guidance. Claude publishes
the turn terminal event only after its SDK iterator and query close, preventing a
previous turn from settling a newly admitted one. OpenClaw startup diagnostics
retain the error tail rather than only startup banners. Restart uses the persisted native ID;
unsupported or failed restore requires a new conversation. If crash recovery has
invalidated the native ID, existing history is retained and sending fails rather
than silently starting an unrelated native session. Non-resumable connections skip
idle TTL reclamation; explicit view/connection closure can still make them
non-resumable.

Request-level `$/cancel_request` uses the SDK's request signal independently of
turn cancellation. Permission, form, Cursor extension, file and terminal handlers
observe it; cancelled approvals cannot authorize later writes or process starts.
Cancelling a terminal wait releases the wait without terminating the terminal.
ACP initialization reports Cherry's actual application version.

## Compatibility record

The unified gateway caps a caller's output token budget at the selected model's
configured `maxOutputTokens` before deriving reasoning options. Smaller budgets,
missing budgets and models with no known ceiling retain their original behavior.
Custom provider limits must reflect that provider's served model: a generic model
catalog ceiling does not establish the limit for every endpoint.

Pi ACP 0.0.34 discards native model failure information and resolves a settled
prompt as `end_turn`, even after retries fail. Cherry cannot reliably classify
that result as a failure from ACP alone. This remains an upstream adapter
limitation; retry text is not used to infer message status.

Authentication, backend availability and native database maintenance remain CLI-owned
prerequisites. Cherry does not repair native databases, downgrade packages, or infer
protocol failures from response prose. Presets describe connection recipes; supported
capabilities come from the connected version, not a historical compatibility table.
See the code-owned [preset catalog](../../../../src/shared/ai/localAgent.ts) and
[installation recipes](../../../../src/main/ai/runtime/localAgent/installRecipe.ts).

## Structured questions

ACP `elicitation/create` form mode uses the existing AskUserQuestion composer.
Only `elicitation.form` is advertised; URL mode is rejected as unsupported.
Session requests must match the active connection and turn. Request-scoped forms
outside a conversation currently return `cancel` without opening a composer.

Flat string, number, integer, boolean, enum and multi-select fields retain native
property IDs and value types. Defaults are visible and editable. Zod's JSON Schema
conversion validates required fields, bounds, formats, patterns and allowed
values in both renderer and main. Selection alone never submits a form; users can
review all fields and explicitly submit, decline, or cancel. Turn completion and
connection shutdown release pending questions and approvals.

Cursor's question extension remains supported independently of standard elicitation.

## Validation

- Migrated SQLite tests: canonical preset identity, enable/disable history,
  provider-free dispatch/persistence, immutable protocol and directory, and missing
  native identity handling.
- Real fixture subprocesses: handshake-only probes, multi-turn identity, permission
  scope, approved file/terminal callbacks, cancellation, crash partial output, replay suppression, unsupported
  restore, standalone approvals, and installation environment precedence.
- Runtime host regression: changing a provisional task's agent discards its old
  prewarmed connection and native identity.
- Renderer tests: native permission options and removal of Cherry-only controls.

See [Adding a Runtime](./adding-a-runtime.md) and
[Agent Session Runtime](./agent-session-runtime.md) for the shared host contract.
Protocol references: [ACP](https://agentclientprotocol.com/protocol/overview),
[Codex App Server](https://developers.openai.com/codex/app-server), and
[Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview).

### CLI sign-in

Agent Services shows sign-in for installed ACP Agents that advertise a protocol-driven
`agent` authentication method. Discovery and model refresh do not start login;
only the user's explicit action sends `authenticate` with an advertised method ID.
Agents offering terminal-only authentication keep their native terminal/help flow;
Cherry does not advertise ACP terminal-auth support or send `authenticate` for those methods.
Poolside also exposes its verified native `pool login` command through the sign-in
action and the existing system-terminal launcher. Opening the terminal is not
reported as successful authentication; returning to Cherry refreshes the model catalog.

The sign-in dialog supports the Agent's browser flow. Antigravity API-key methods
collect a masked key; Agent Platform also supports a project and region with
existing Application Default Credentials. Only environment overrides explicitly
entered for sign-in are saved to the Agent; CLI-owned account credentials are not
read or copied. Completing OAuth without changing overrides does not rewrite the
Agent configuration.

Cursor's native account-status command can verify an existing sign-in and show
“Signed in”. Other Agents retain the “Sign in” action; model refresh and successful
session creation do not change its label or icon. Neither a cached model list nor
a protocol handshake proves account authentication or model access. Background
checks remain quiet; explicit sign-in errors remain visible, including region
restrictions.

Authentication has a five-minute timeout. Canceling, changing the program, closing
the panel, or application shutdown releases the owned ACP process. Late responses
cannot report success or persist credentials after cancellation. Sign-in refreshes
the model catalog; native CLI authentication errors open the matching Agent in Agent services.
Errors identifying a Cherry upstream provider retain that provider's recovery link.
