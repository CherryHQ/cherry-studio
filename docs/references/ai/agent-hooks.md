---
description: User-configured local command Hooks for Pi, Claude Code, and DSH agent sessions
sources:
  - src/shared/ai/agentHook.ts
  - src/main/ai/agentSession/AgentHookSession.ts
  - src/main/ai/runtime
  - src/renderer/pages/settings/components/AgentHooksField.tsx
  - src/renderer/pages/settings/HooksSettings.tsx
---

# Agent Hooks

Configure global Hooks in **Settings → Tools → Hooks**. This is the only editor;
the agent edit dialog has no Hook tab. Rules apply to all Cherry Pi, Claude Code,
and DSH agent sessions, including background turns, but not ordinary AI SDK chats
or standalone external CLIs. Settings use the fixed `agent.hooks` Preference key,
defaulting to an empty list. No SQL migration or dependency installation is needed.
The unreleased per-agent configuration is not migrated, merged, or executed.

## Trust and execution

Hooks execute with the local user's permissions **outside the agent sandbox**.
Only enable commands you trust. Keep executable scripts outside directories the
agent can modify; enabling a trusted script does not make future edits to that
file trustworthy. Hook output does not grant tool permissions or become a system
prompt. This is automation, not a substitute for sandboxing or approval policy.

New Hooks are disabled. Editing a command, event, match condition, or timeout disables that Hook
until explicitly enabled again. Adding, enabling, disabling, and confirmed deletion
are persisted immediately; text edits are auto-saved after a short delay. Failed
auto-saves keep the current edit and expose a retry action. Editing is unavailable
until the initial load succeeds. Viewing and editing never execute scripts.
Main validates a snapshot of the global rules at each event. Changes affect subsequent
events without reconnecting, not commands already in progress. They do not replay
startup or past events. Malformed settings fail closed for pre-tool calls.

Commands run in the Main-resolved session workspace, using the login-shell
environment plus the agent's configured environment variables. Runtime API keys
are not added by the Hook adapter. The command shell is Windows PowerShell on
Windows and `/bin/sh` on macOS/Linux. Commands and script paths must match the
host platform; Cherry does not translate shell syntax. No interpolation of tool
arguments or model text into the configured command line takes place.

## Events

Tool events use public native interfaces: Claude SDK `PreToolUse`, `PostToolUse`,
and `PostToolUseFailure`; Pi extension `tool_call` and `tool_result`; DSH plugin
`tools/pre-execute` and `tools/execute`. Matching and command execution remain in Main.
The other four events use Cherry's lifecycle and presented-interaction boundaries,
which do not coincide reliably with native startup, intermediate-turn, or permission
events. Each event has one owner; a native failure never triggers a second application
attempt. Cherry does not write native CLI configuration files or interpret their
runtime-specific script protocols.

| Event | Boundary | Failure behavior |
| --- | --- | --- |
| `sessionStart` | Once per runtime connection, at the first execution, including resume; opening the UI or prewarming alone does not execute it | Log and continue |
| `preToolUse` | The runtime's pre-execution gate, before ordinary approval | Nonzero exit, timeout, cancellation, invalid input, or launch failure denies the tool and returns a reason to the model |
| `postToolUse` | The SDK reports a successful tool execution | Log only; do not replace the tool result |
| `postToolUseFailure` | The SDK reports failed tool execution | Log only; preserve the original failure |
| `questionRequested` | A structured user-question interaction has been presented | Notify only; never answer the question |
| `approvalRequested` | A permission or plan-review request has been presented | Notify only; never approve or reject the request |
| `turnEnd` | A complete runtime reply | Log and continue |

Once started, `sessionStart` belongs to the connection, not its first caller. Cancelling
one turn or tool call does not cancel shared startup or skip it for later calls. Startup
still obeys command timeouts and is cancelled and drained when the connection closes.
Environment acquisition follows the same cancellation scope. Concurrent consumers share
one capture; cancelling its last consumer terminates and drains the login-shell process
group. Cancelled captures are not cached, and Windows skips registry reads if cancelled
while loading the registry module.

`turnEnd` runs asynchronously after the host marks the runtime reply complete. It does not
delay stream completion, persistence, or the next turn. Its message ID stays bound to the
completed reply; it is not a barrier for subsequent tools or file operations. Connection
teardown still cancels and drains outstanding Hook commands.

Question and approval notifications run after the interaction is visible and do not
block its response. One approval ID is notified once per connection. Failed presentation,
automatic permissions, and headless denials do not trigger these events. Question requests
are distinct from permission requests and do not also fire `approvalRequested`.
`questionRequested` refers to a structured interaction, not question marks in assistant prose.
It fires only when the runtime exposes a structured question through Cherry's interaction
bridge; the Hook adapter does not invent a missing question tool or infer one from prose.

Optional `matcher.toolNameContains` and `matcher.inputContains` fields use case-sensitive
literal substring matching. The latter matches serialized `toolInput` JSON, not the output
or command. Empty fields impose no condition; all nonempty conditions must match. They do
not evaluate expressions, regular expressions, or shell fragments.

SDK tool names are preserved (`Write` in Claude, `write` in Pi, etc.). Pi Code
Mode nested calls and DSH delegated calls also traverse the tool boundary. Nested
calls use their own tool-call IDs; the session ID remains the application's root
session. A call refused before execution may not emit a post-tool event, depending
on the SDK. Cancellation does not start new notification commands.

Within one event, matching commands run in configured order; the first pre-tool
denial stops that list. Different concurrent tool calls may run Hooks concurrently.
Scripts must coordinate their own shared resources and should not launch detached
background work. The host cancels active Hook processes on runtime teardown and
uses process-tree termination on timeout/cancellation (Windows `taskkill /T /F`,
POSIX process groups). This is best-effort OS process cleanup, not containment of
deliberately detached or privileged descendants.

## Command protocol

Each command receives one UTF-8 JSON document on stdin, then EOF:

```json
{
  "version": 1,
  "event": "preToolUse",
  "sessionId": "application-session-id",
  "agentId": "agent-id",
  "runtime": "pi",
  "cwd": "absolute workspace path",
  "toolName": "write",
  "toolCallId": "runtime-tool-call-id",
  "toolInput": { "path": "example.txt", "content": "hello" }
}
```

Tool events may additionally carry `toolOutput` or `error`; non-tool events may
carry `messageId`. Interaction events carry `approvalId`, `toolCallId`, `toolName`,
and `toolInput`. These fields are untrusted event data, not executable code.
Exit `0` to continue. Other exit codes deny only `preToolUse`; up to 4,096
characters of stdout/stderr accompany its failure reason. Successful output is
not injected into model context. Execution metadata and failures are recorded by
the `AgentHookSession` logger, without automatically logging successful output.

Limits: 16 global Hooks; 60 seconds per command; 1 MiB of JSON input; 64 KiB
combined stdout/stderr per command. Oversized input is rejected, not silently
truncated. Oversized output terminates the command. Claude's separate SDK matcher
budget accommodates the configured command sequence and cleanup, so the SDK does
not discard a late denial under its default short callback timeout.

For example, save this Node script in a trusted location and configure a command
that runs it using an absolute path (quote paths with spaces):

```js
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  const event = JSON.parse(input)
  if (event.event === 'preToolUse' && ['Bash', 'bash', 'pwsh'].includes(event.toolName)) {
    console.error('Shell tools are disabled by this agent Hook.')
    process.exitCode = 2
  }
})
```

This example filters direct shell-tool requests only; it does not prevent other
tools or processes from performing equivalent actions.

## Ownership and verification

`AgentSessionRuntimeService` owns one `AgentHookSession` per runtime connection.
`AgentHookSession` owns configuration matching, shell selection, and Hook failure policy.
It delegates command execution to `src/main/utils/processRunner.ts::executeCommand()`:
the shared runner owns cwd/stdin, output collection, timeout/cancellation, and process-tree
cleanup. Hooks request structured exit results; existing callers still receive stdout
and reject on failure by default.
Drivers receive a Main-only callback, not shell commands or renderer-provided
paths. Claude's prewarmed SDK callbacks resolve the currently bound handler;
DSH transports event data over its authenticated per-connection bridge and relays
cancellation by invocation ID. Reconnecting does not replay completed tool events.
Hooks are not a durable exactly-once job system: a crash can interrupt a command,
and a new runtime connection fires `sessionStart` again.

Regression tests extend the existing runtime, bridge, PreferenceService, settings,
and agent-edit suites. They cover real command stdin/exit/timeout/cancellation,
real SQLite global configuration round trips, real DSH SDK execution, Full Access
rejection, warm Claude callbacks, post-result preservation, live global rules across
agents, ignored legacy rules, explicit UI re-enabling, auto-save serialization and
failure recovery, and confirmed deletion.
