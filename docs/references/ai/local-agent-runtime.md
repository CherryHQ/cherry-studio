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

The composer remembers up to 100 sessions' configuration display snapshots in
renderer memory. Returning to a session shows its previous options immediately;
changes stay disabled until live session information arrives. Cached snapshots do
not enable attachment capabilities. A single configurable item opens its choices
directly and shows its name and current value in the trigger; multiple items use
submenus. Starting or ending generation does not clear the configuration display.

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

Validation environment: macOS ARM64; installed-agent acceptance refreshed 2026-09-30. Other platforms require real CLI
acceptance before being marked verified. Presets are discoverable configuration
entries, not a claim that every installed version implements the protocol.

| Preset | Launch | Observed version | Verification |
|---|---|---|---|
| Claude Code | Installed CLI through SDK | 2.1.207 | Real text, read/write tools, approval, connection release/resume, stop and continuation passed with CLI default model after reauthentication; configured `claude-sonnet-4-6` was rejected by the current endpoint (2026-09-30) |
| Codex | `codex app-server` | 0.155.1 | Real text, read/write tools, connection process exit/recreation, native ID recovery, stop and continuation passed (2026-09-30) |
| GitHub Copilot | `copilot --acp` | 1.0.89 | Real text, mode/reasoning changes and restoration, generic permission configuration round-trip, read/write tools, diff, approval, process release/resume, stop and continuation passed (2026-09-30) |
| MiniMax Code | `mcode acp` | — | Not installed locally; launch contract and shared ACP fixture tests passed |
| Cursor | `cursor-agent acp` (`agent` alias) | 2026.01.28-fd13201 | Real text, agent → plan → agent, read/write tools and diff, process release/resume, stop and continuation passed; custom question/plan extensions not exercised (2026-09-30) |
| Kimi | `kimi acp` | — | Not tested |
| Qwen Code | `qwen --acp` | — | Not tested |
| OpenCode | `opencode acp` | 1.18.33 | Real text, build → plan → build, file read/write, process release/resume, stop and continuation passed; first edit attempt stalled without output, stopped and explicit retry passed (2026-09-30) |
| Kiro | `kiro-cli acp` | — | Not tested |
| Qoder | `qoderclicn --acp` (aliases supported) | — | Not tested |
| Trae | `traecli acp serve` | — | Not tested |
| Hermes | `hermes acp` | 0.21.1 | Real text, file read/write and edit approval, process release/resume, stop and continuation passed; missing terminal updates display “Result not reported” after the turn (2026-09-30) |
| Cline | `cline --acp` | — | Registry launch definition checked (3.0.65); real CLI acceptance pending |
| Kilo | `kilo acp` | 7.8.1 | Auto Free: real text, code → ask → code, read/write tools, process release/resume, stop and continuation passed; manual `/compact` works but does not emit ACP compaction updates (2026-09-30) |
| goose | `goose acp` | — | Registry launch definition checked (1.52.0); real CLI acceptance pending |
| Codebuddy Code | `codebuddy --acp` | — | Registry launch definition checked (2.159.0); real CLI acceptance pending |
| Auggie CLI | `auggie --acp` | — | Registry launch definition checked (0.36.0); real CLI acceptance pending |
| Junie | `junie --acp=true` | — | Registry launch definition checked (3419.16.0); real CLI acceptance pending |
| Factory Droid | `droid exec --output-format acp-daemon` | — | Registry launch definition checked (0.228.0); real CLI acceptance pending |
| Devin | `devin acp` | — | Registry launch definition checked (3000.11.3); real CLI acceptance pending |
| Google Antigravity | `agy_acp_server.par` | 1.2.1 | Configured Gemini 3.7 Flash Medium: real text, read/write tools and diff, approval, process release/resume, stop and continuation passed; identical file callbacks reuse one native approval (2026-09-30) |
| Mistral Vibe | `vibe-acp ` | — | Registry launch definition checked (2.25.8); real CLI acceptance pending |
| Amp | `amp-acp ` | — | Registry launch definition checked (0.9.0); real CLI acceptance pending |
| pi ACP | `pi-acp ` | 0.0.34 | Real text, medium → low → medium reasoning, read/write tools and diff, process release/resume, stop and continuation passed (2026-09-30) |
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

Antigravity advertises session loading/resuming, images, audio, embedded context, and HTTP/SSE MCP in its handshake. Text, tools, cancellation and recovery passed with the configured credentials on 2026-09-30. The earlier personal Google OAuth location/eligibility rejection remains an authentication-method finding, not a current conversation failure. Image/audio semantics and MCP integration are still unverified; advertised capabilities alone do not certify them.

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
question/plan extension interactions remain unverified; authenticated text and native mode switching passed separately. Cherry does
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
after reload, and both themes. The real-agent run below additionally exercised tool output and native diff payloads.
Image/audio/resource output still requires a real agent that emits those content types.

### Real-agent acceptance, 2026-09-30

The installed set was nine agents (seven ACP, two native) out of 32 presets.
The other 23 presets were not installed and remain unverified. Each test used a
separate system workspace and existing CLI credentials; no permission-bypass
mode was enabled and existing global model selections were preserved.

The real Electron main/preload/renderer and production database were used:

1. Create an isolated session, verify a short reply, and retain a per-agent recall marker.
2. Switch supported mode/reasoning controls to a safe alternative and restore the
   original value. Copilot's generic `allow_all` option round-tripped `off`;
   permissive alternatives were not enabled. Other tested ACP agents returned
   no generic configuration options, so boolean configuration remains fixture-only.
3. Read a unique marker file through the agent's tools. Confirm streamed chunks,
   persisted tool data and the returned content in the real chat window.
4. Release the warm lease and wait beyond its ten-second grace period. For the
   eight original working configurations, verify their workspace process IDs
   disappeared, then verify new process IDs, unchanged native resume IDs, correct
   recall, and exactly two new Cherry messages (no replayed history). Claude's
   temporary CLI-default configuration additionally passed release and recall;
   its process IDs were not separately sampled.
5. Abort on the first real text/reasoning delta. All nine attempts persisted as
   `paused`; all nine subsequent turns returned `CONTINUE_OK` successfully.
6. Create only `acceptance-result.txt` in each isolated workspace. Inspect the
   requested path/content before allowing individual approval requests, then
   compare actual file contents to the expected per-agent marker.

| Output / configuration surface | Real evidence | Remaining boundary |
|---|---|---|
| Text, reasoning, file-read tools | All nine returned the correct file content; streamed deltas and persisted tool parts were inspected | Hermes tool completion missing, below |
| ACP native diff content | pi, Antigravity, Copilot and Cursor emitted `type: diff` for the controlled write | Kilo and OpenCode writes completed without native diff content |
| Approval presentation | Copilot, Antigravity, Hermes, Claude and Codex emitted approval requests | Denial, remembered grants and cancellation while awaiting approval were not revalidated in this run |
| Generic configuration | Copilot `allow_all=off` accepted; native mode/reasoning changes restored successfully where safe alternatives existed | No real boolean option advertised by the tested agents |
| Standalone image/audio/resource output | None of these turns emitted `data-acp-content` | Controlled-process coverage only; not certified as real-agent support |
| Session titles | Copilot and Hermes updated generated titles; manually renamed titles survived connection release and reload | Other agents did not change titles in these turns; no forced conflicting title event was injected |
| Notices, compaction events | Not emitted during the common acceptance turns | Kilo `/compact` separately succeeded without `compaction_update`; do not infer events from reply text |
| Platform coverage | macOS ARM64 only | Windows and Linux still need real CLI acceptance |

Real findings that keep full compatibility acceptance open:

- **Hermes tool completion:** successful reads and writes left their execution
  cards in `input-available`. A separate direct ACP read reproduced a lone
  `tool_call` with no `tool_call_update`; the edit-approval card itself settled.
  Cherry now persists a turn-ended marker and displays “Result not reported”
  instead of leaving the card running. A fresh real write and the expanded
  Electron tool card verified this behavior; execution success is not inferred.
- **Antigravity duplicate approval:** one file creation emitted both a native
  permission request and a subsequent `fs/write_text_file` request. Cherry asked
  again for the file callback. Native approved diff content now authorizes only
  one identical path/content write in the same turn. Changed or repeated writes
  need a separate approval; unused grants expire at turn end. A fresh real
  Antigravity creation completed with one approval and matching file contents.
- **Claude model configuration:** expired OAuth blocked the first attempt. After
  the user repaired authentication, the explicitly selected `claude-sonnet-4-6`
  was rejected with HTTP 400 by the current endpoint. A temporary CLI-default
  configuration passed all common conversation checks; this does not validate
  the original model selection against that endpoint.

A subsequent real Hermes turn was cancelled while awaiting edit approval; no file
was written and the turn persisted as paused. Antigravity's second turn produced
no response within the bounded follow-up, so real denial was not certified and
the turn was stopped. Remembered option IDs and denial/cancel paths are covered
by controlled protocol tests, not claimed as fresh real-agent acceptance.

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

Controlled protocol processes cover accepted, invalid, declined, cancelled,
foreign-session and unsupported-mode requests. Electron acceptance verified
numeric validation and submission of `{ count: 3, enabled: false }`. These tests
verify Cherry's form flow; no installed real agent emitted standard elicitation
during this run. Cursor's existing question extension remains supported.

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
