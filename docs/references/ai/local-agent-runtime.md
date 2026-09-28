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

Settings → Local Agents discovers installed CLIs and enables them as persistent
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
| ACP | ACP session ID | Negotiated model config option | Original option IDs and scopes |

ACP declares implemented text-file and terminal callbacks. Writes and terminal
creation require user approval; terminals belong to their connection. Working
directories are not OS sandboxes. ACP replay during session loading is suppressed
because Cherry already owns the displayed transcript.

Tools merge by native call ID. Standalone permission IDs settle their own cards.
Unknown tool results use generic cards. Missing token/cost/model data is not
invented. Images and model controls use connected capabilities; native slash
commands populate the existing command menu.

Stop first requests protocol cancellation, then closes the owned process tree if
necessary. Pending approvals resolve as denied/cancelled. Process failures retain
received output and do not replay a turn. Restart uses the persisted native ID;
unsupported or failed restore requires a new conversation. If crash recovery has
invalidated the native ID, existing history is retained and sending fails rather
than silently starting an unrelated native session. Non-resumable connections skip
idle TTL reclamation; explicit view/connection closure can still make them
non-resumable.

## Compatibility record

Validation environment: macOS, 2026-09-28. Other platforms require real CLI
acceptance before being marked verified. Presets are discoverable configuration
entries, not a claim that every installed version implements the protocol.

| Preset | Launch | Observed version | Verification |
|---|---|---|---|
| Claude Code | Installed CLI through SDK | 2.1.207 | Handshake passed; real request blocked by expired OAuth session |
| Codex | `codex app-server` | 0.155.1 | Handshake, multi-turn text, file write, stop, and application-restart context recovery passed |
| GitHub Copilot | `copilot --acp` | — | Not installed locally; launch contract and shared ACP fixture tests passed |
| MiniMax Code | `mcode acp` | — | Not installed locally; launch contract and shared ACP fixture tests passed |
| Cursor | `cursor-agent acp` (`agent` alias) | 2026.01.28-fd13201 | Real handshake passed; conversation blocked by missing CLI authentication |
| Gemini CLI | `gemini --acp` | — | Not tested |
| Kimi | `kimi acp` | — | Not tested |
| Qwen Code | `qwen --acp` | — | Not tested |
| OpenCode | `opencode acp` | — | Not tested |
| Kiro | `kiro-cli acp` | — | Not tested |
| Qoder | `qoderclicn --acp` (aliases supported) | — | Not tested |
| Trae | `traecli acp serve` | — | Not tested |
| Hermes | `hermes acp` | CLI did not report `--version` | Handshake, multi-turn context, edit approval and file write passed |
| Custom ACP | Explicit executable and arguments | User selected | Controlled fixture processes tested |

Cursor's `cursor/ask_question` and `cursor/create_plan` blocking extensions use the
existing question composer and approval flow. Question and option IDs are retained
separately from display labels; choice-only prompts do not offer free-text answers.
Plan approval is explicit, and stopping cancels outstanding requests. Controlled
protocol processes cover selection, approval, rejection and cancellation. Real Cursor
extension interactions remain unverified until CLI login is available. Cherry does
not invoke browser login automatically.

Hermes interruption/recovery is **not fully verified**: stopping settled the Cherry
turn as paused, but the first restored response included output from the interrupted
request. A subsequent prompt recovered the original marker. Treat this combination
as a native compatibility issue requiring further acceptance, not a passed restore
contract. Normal text and explicit edit approval were verified separately.

Real CLI image input, model switching, Windows command wrappers, and all remaining
preset/platform combinations are pending acceptance. No CLI installation manager,
CLI history import, scheduled tasks, heartbeat, or native fork UI is provided by
this feature.

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
