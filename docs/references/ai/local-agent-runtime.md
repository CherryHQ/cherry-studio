---
description: Local CLI agent configuration, native model ownership, protocol drivers, installation reuse, and compatibility verification
sources:
  - src/shared/ai/localAgent.ts
  - src/shared/ai/executionIdentity.ts
  - src/main/ai/runtime/localAgent
  - src/main/ai/agentSession/AgentSessionRuntimeService.ts
  - src/renderer/pages/settings/LocalAgentSettings/LocalAgentSettingsPage.tsx
---

# Local Agent Runtime

Settings → Agent Services discovers installed CLIs and enables them as persistent
agents. Each preset has one stable agent ID; custom ACP configurations have
independent IDs. Disabling preserves conversations and ordering. No Cherry model
provider is required. “Local” refers to the CLI process, not an offline model.

## Ownership and routing

- Agent configuration is SQLite business data under `configuration.localRuntime`.
  Detection, connection checks, and session capability reads use IpcApi.
- Stream execution identities use `runtime:<agent-id>`; this is never stored as a
  provider/model foreign key. Message snapshots retain the author and native model
  identifier when reported by the CLI.
- `AgentSessionRuntimeService` owns turn scheduling, approvals, persistence and
  connection disposal. The local driver maps ACP, Claude Agent SDK, and Codex
  App Server into the existing runtime event contract.
- The CLI owns authentication, model selection, project settings, MCP and Skills.
  Cherry does not inject its own providers, prompts, knowledge bases or tools.
- A new local task defaults to its own managed directory. An empty task can select
  an existing project; sending its first message locks the agent and directory.
  Missing user directories are reported rather than created.

## Installation and connection

Resolution order is explicit executable, CodeMate-managed installation, then
system installation. Explicit paths fail without fallback. Every connection
resolves installation facts again, so upgrades do not pin an old version path.
Managed installations use the shared binary execution environment; system CLIs
retain the user's shell environment. Explicit environment overrides apply last.

Passive discovery queries BinaryManager without starting an agent. Check/enable
starts a bounded protocol handshake with no model prompt or automatic login.
Handshake success does not prove credentials or model availability. Native CLI
configuration errors remain visible during the first real request.

Startup arguments are arrays, never shell strings. Environment overrides are
stored as user configuration; request logs and DataApi devtools redact local
arguments and environment values. CLI credentials are neither scanned nor copied.

## Protocol behavior

| Driver | Session identity | Model selection | Permissions |
|---|---|---|---|
| Claude Code | SDK native session ID | SDK model catalog, CLI default otherwise | SDK `canUseTool` requests |
| Codex | App Server thread ID | `model/list`, CLI default otherwise | Native decisions and permission requests |
| ACP | ACP session ID | Model config option, with legacy `models` / `session/set_model` fallback | Original option IDs and scopes |

ACP declares implemented text-file and terminal callbacks. Writes and terminal
creation require user approval; terminals belong to their connection. Working
directories are not OS sandboxes. ACP replay during session loading is suppressed
because Cherry already owns the displayed transcript.

During session creation/loading, command and configuration notifications are buffered
and applied only to the matching native session. Transcript/tool replay is not
rendered again. Modern model configuration takes precedence when both model
interfaces are advertised; a failed model selection is not silently ignored.

Connection checks expose `protocolInfo`: protocol version, reported agent identity,
advertised capabilities, authentication method names, and completed verification
stages. A handshake-only check records only `handshake`; a live session adds
`session`, then `prompt` after a protocol prompt response. These stages do not
certify tool execution, cancellation or recovery, and are not persisted as a
blanket compatibility claim. Logs contain agent identity/version, not credentials.

ACP stop reasons map to stream finish reasons: `end_turn` → `stop`,
`max_tokens` / `max_turn_requests` → `length`, and `refusal` → `content-filter`.
`cancelled` uses the stream cancellation path and persists a paused turn. Limit
and refusal reasons are preserved in the stream; the existing shared message
status still describes completion of the stream, not completion of the user's task.

ACP `thought_level` select options use the shared response-settings control. Known
levels use translated labels and the same slider as provider models; custom values
retain their native names and IDs. Fixed single-value options are not shown as
adjustable controls. Changes apply to the current native session, not the global
Agent. The UI updates on confirmed protocol state and does not invent a default
option. Pending changes settle before the next prompt; running turns cannot be
reconfigured through this control.

ACP session modes localize recognized names and descriptions in the composer while
preserving custom text and native IDs. Modern
`mode` config options take precedence over legacy `modes` / `session/set_mode`.
Mode and reasoning changes share an in-flight guard; confirmed notifications refresh
the controls, and failed requests preserve the last confirmed value. Modes remain
session-owned and do not change Cherry's permission policy or the global Agent.

ACP thought chunks become ordinary reasoning parts, closing at text/tool/plan
boundaries and turn completion. Plans use a dedicated `data-agent-plan` message
part; full snapshots replace the same per-turn part and reuse the task-list view.
They are not synthetic tool calls. Loading native history suppresses both thoughts
and plans to avoid duplicating Cherry's persisted transcript.

Tool updates merge native status, input/output, content and locations by call ID.
The tool disclosure renders text, file diffs, file links with reported line numbers,
and snapshots of client-owned terminal output. Unrecognized content retains a raw
fallback. File links open the file; editor navigation to the reported line is not
yet implemented. Stored terminal snapshots remain readable after process release.

Enabled local sessions prewarm on opening so their options are available before
the first message. Config notifications refresh the controls, including when a model
change removes thought levels. On reconnect, native session configuration is the
source of truth: Cherry does not reselect an already-matching model and thereby
reset the restored effort. Persistence of unused settings depends on the CLI; Cherry
does not store a second copy of native thought settings.

Tools merge by native call ID. Standalone permission IDs settle their own cards.
Unknown tool results use generic cards. Missing token/cost/model data is not
invented. Images and model controls use connected capabilities; native slash
commands populate the existing command menu.

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
received output and do not replay a turn. Restart uses the persisted native ID;
unsupported or failed restore requires a new conversation. If crash recovery has
invalidated the native ID, existing history is retained and sending fails rather
than silently starting an unrelated native session. Non-resumable connections skip
idle TTL reclamation; explicit view/connection closure can still make them
non-resumable.

## Compatibility record

Validation environment: macOS, 2026-09-28; ACP P0 checks refreshed 2026-09-29. Other platforms require real CLI
acceptance before being marked verified. Presets are discoverable configuration
entries, not a claim that every installed version implements the protocol.

| Preset | Launch | Observed version | Verification |
|---|---|---|---|
| Claude Code | Installed CLI through SDK | 2.1.207 | Handshake passed; real request blocked by expired OAuth session |
| Codex | `codex app-server` | 0.155.1 | Handshake, multi-turn text, file write, stop, and application-restart context recovery passed |
| GitHub Copilot | `copilot --acp` | — | Not installed locally; launch contract and shared ACP fixture tests passed |
| MiniMax Code | `mcode acp` | — | Not installed locally; launch contract and shared ACP fixture tests passed |
| Cursor | `cursor-agent acp` (`agent` alias) | 2026.01.28-fd13201 | Real handshake passed; conversation blocked by missing CLI authentication |
| Kimi | `kimi acp` | — | Not tested |
| Qwen Code | `qwen --acp` | — | Not tested |
| OpenCode | `opencode acp` | — | Not tested |
| Kiro | `kiro-cli acp` | — | Not tested |
| Qoder | `qoderclicn --acp` (aliases supported) | — | Not tested |
| Trae | `traecli acp serve` | — | Not tested |
| Hermes | `hermes acp` | 0.21.1 (ACP `agentInfo`) | Handshake, multi-turn context, edit approval and file write passed; application restart, stop with partial output, and continuation passed (2026-09-29) |
| Cline | `cline --acp` | — | Registry launch definition checked (3.0.65); real CLI acceptance pending |
| Kilo | `kilo acp` | 7.8.1 | Real handshake, model catalog, thought-level selection, restored value, and native mode switching (code → plan → code) passed (2026-09-29); GPT-6 Sol prompt blocked by CLI sign-in requirement; text and token persistence previously verified with Auto Free |
| goose | `goose acp` | — | Registry launch definition checked (1.52.0); real CLI acceptance pending |
| Codebuddy Code | `codebuddy --acp` | — | Registry launch definition checked (2.159.0); real CLI acceptance pending |
| Auggie CLI | `auggie --acp` | — | Registry launch definition checked (0.36.0); real CLI acceptance pending |
| Junie | `junie --acp=true` | — | Registry launch definition checked (3419.16.0); real CLI acceptance pending |
| Factory Droid | `droid exec --output-format acp-daemon` | — | Registry launch definition checked (0.228.0); real CLI acceptance pending |
| Devin | `devin acp` | — | Registry launch definition checked (3000.11.3); real CLI acceptance pending |
| Google Antigravity | `agy_acp_server.par` | 1.2.1 | System binary installation and real ACP handshake passed (macOS ARM64, 2026-09-29); model discovery requires authentication; personal Google OAuth rejected account eligibility for the current location |
| Mistral Vibe | `vibe-acp ` | — | Registry launch definition checked (2.25.8); real CLI acceptance pending |
| Amp | `amp-acp ` | — | Registry launch definition checked (0.9.0); real CLI acceptance pending |
| pi ACP | `pi-acp ` | — | Registry launch definition checked (0.0.34); real CLI acceptance pending |
| DeepAgents | `deepagents-acp ` | — | Registry launch definition checked (0.1.7); real CLI acceptance pending |
| GLM Agent | `glm-acp-agent ` | — | Registry launch definition checked (1.12.0); real CLI acceptance pending |
| Grok Build | `grok agent stdio` | — | Registry launch definition checked (1.0.43); real CLI acceptance pending |
| Cortex Code | `cortex acp serve` | — | Registry launch definition checked (1.0.73); real CLI acceptance pending |
| fast-agent | `fast-agent-acp -x` | — | Registry launch definition checked (0.10.1); real CLI acceptance pending |
| Stakpak | `stakpak acp` | — | Registry launch definition checked (0.3.88); real CLI acceptance pending |
| VT Code | `vtcode acp` | — | Registry launch definition checked (0.96.14); real CLI acceptance pending |
| Poolside | `pool acp` | — | Registry launch definition checked (1.0.16); real CLI acceptance pending |
| Custom ACP | Explicit executable and arguments | User selected | Controlled fixture processes tested |

Gemini CLI is no longer offered as an Agent Service preset. Existing session history is retained; retired presets are excluded from the active Agent picker. This does not remove Gemini model providers or uninstall the CLI.

Antigravity advertises session loading/resuming, images, audio, embedded context, and HTTP/SSE MCP in its handshake. These are advertised capabilities, not completed acceptance tests. Model discovery returns `Authentication required`. A real `oauth-personal` attempt was rejected because the account is ineligible for the free tier in its current location. Authenticated text, model switching, tools/approval, cancellation, images, and session recovery remain the next acceptance steps with an eligible account.

The 20 additional presets use the [ACP Registry](https://github.com/agentclientprotocol/registry)
launch definitions checked on 2026-09-28. Registry versions in this table are
reference versions, not versions installed or tested by Cherry. No packages are
silently downloaded when detecting or connecting to a preset.

Amp requires `amp-acp`, Pi requires `pi-acp`, DeepAgents requires `deepagents-acp`,
and GLM requires `glm-acp-agent`. Antigravity uses Google's separate
`agy_acp_server.par` (or `agy_acp_server.exe` on Windows), not the Antigravity CLI
already available in CodeMate. Vibe uses `vibe-acp`, and fast-agent uses
`fast-agent-acp`. Install the ACP entry point from the preset's registry link and
make it available on PATH, or select its explicit path in advanced settings.

Antigravity uses the registry's `--uid=` argument on Linux. Auggie and Droid
receive the registry's auto-update suppression variables, and VT Code receives
its ACP feature flags; explicit user environment values take precedence.
fast-agent preserves the user's model configuration instead of injecting the
registry's suggested `FAST_AGENT_MODEL=codexplan`. Models and authentication
must be configured in the CLI before use.

Cursor's `cursor/ask_question` and `cursor/create_plan` blocking extensions use the
existing question composer and approval flow. Question and option IDs are retained
separately from display labels; choice-only prompts do not offer free-text answers.
Plan approval is explicit, and stopping cancels outstanding requests. Controlled
protocol processes cover selection, approval, rejection and cancellation. Real Cursor
extension interactions remain unverified until CLI login is available. Cherry does
not invoke browser login automatically.

Hermes interruption and application-restart recovery were revalidated on 2026-09-29,
as recorded in the compatibility table. Earlier interrupted-output replay findings
have been superseded by that acceptance run.

System installation and uninstallation are available through registry recipes;
existing CodeMate/system installations take precedence. Real CLI image input,
Windows command wrappers, and unlisted preset/platform combinations remain pending.
CLI history import, scheduled tasks, heartbeat, and native fork UI are not provided.
Attachment acceptance on 2026-09-29 verified Kilo reading a real text attachment
through an ACP resource link and returning its content. Pasted image bytes were
persisted in Cherry, but Kilo Auto Free reported no vision support. A direct Hermes
ACP image probe returned an incorrect description of a controlled test image, so
neither combination is recorded as verified vision support. Controlled-process tests
cover image payloads, embedded text/binary/empty resources, managed file IDs, encoded
paths, and rejecting missing or unsupported attachments before dispatch.

Mode/output capabilities have controlled-process coverage. Electron acceptance with
a controlled ACP process verified thought/plan/diff rendering, persisted history
after reload, and both themes. Kilo native mode switching was verified separately;
other CLI output capabilities still require real-agent acceptance.

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

### ACP sign-in

Agent Service settings offer sign-in for installed ACP agents. An explicit click
probes the agent's advertised authentication methods; selecting a method calls
ACP `authenticate` without creating a conversation. Successful authentication
refreshes connection information and the model catalog. Agents with no advertised
methods retain their external sign-in instructions. The chat model menu links to
the corresponding settings entry when authentication is required.

Authentication processes belong to `LocalAgentAuthService`: cancellation, panel
unmount, application shutdown, and a five-minute timeout close the connection.
Account eligibility errors remain failures; protocol handshake alone does not
certify authentication or model access.

For Antigravity, selecting Gemini API key opens a masked required input and
persists `GEMINI_API_KEY` in the Agent's existing environment configuration after
authentication. Agent Platform accepts `GOOGLE_API_KEY`, or
`GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` with externally configured ADC.
Enterprise OAuth reads `gcp.project` and `gcp.location` from the CLI's own settings;
the dialog explains this prerequisite without rewriting the CLI configuration.
An authentication response is not proof of API-key validity or paid model access.
