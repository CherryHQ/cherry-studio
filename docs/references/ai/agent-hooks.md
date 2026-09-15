---
description: User-configured local command Hooks for Pi, Claude Code, and DSH agent sessions
sources:
  - src/shared/ai/agentHook.ts
  - src/main/ai/agentSession/AgentHookSession.ts
  - src/main/ai/runtime
  - src/renderer/components/resourceCatalog/dialogs/components/AgentHooksField.tsx
  - src/renderer/pages/settings/HooksSettings.tsx
---

# Agent Hooks

Configure Hooks in the agent edit dialog's **Hooks** tab. This feature applies to
Pi, Claude Code, and DSH agent sessions, not the internal AI SDK chat-loop hooks.
**Settings → Tools → Hooks** lists configured Hooks grouped by agent, including
disabled Hooks. **Edit** opens that agent's Hooks tab; saving refreshes the list.
The overview paginates agents and never runs commands when displaying them.
Settings live in the existing `Agent.configuration.hooks` JSON field; no SQL
migration, dependency installation, or workspace configuration discovery is needed.

## Trust and execution

Hooks execute with the local user's permissions **outside the agent sandbox**.
Only enable commands you trust. Keep executable scripts outside directories the
agent can modify; enabling a trusted script does not make future edits to that
file trustworthy. Hook output does not grant tool permissions or become a system
prompt. This is automation, not a substitute for sandboxing or approval policy.

New Hooks are disabled. Editing a command, event, match condition, or timeout disables that Hook
until explicitly enabled again. The form auto-saves through the normal Agent
DataApi update; it never executes scripts for previews or validation. Main reads
the current configuration at each event. A change does not interrupt a Hook that
has already started. Malformed executable settings fail closed for pre-tool calls.

Commands run in the Main-resolved session workspace, using the login-shell
environment plus the agent's configured environment variables. Runtime API keys
are not added by the Hook adapter. The command shell is Windows PowerShell on
Windows and `/bin/sh` on macOS/Linux. Commands and script paths must match the
host platform; Cherry does not translate shell syntax. No interpolation of tool
arguments or model text into the configured command line takes place.

## Events

| Event | Boundary | Failure behavior |
| --- | --- | --- |
| `sessionStart` | Once per runtime connection, at the first execution, including resume; opening the UI or prewarming alone does not execute it | Log and continue |
| `preToolUse` | The runtime's pre-execution gate, before ordinary approval | Nonzero exit, timeout, cancellation, invalid input, or launch failure denies the tool and returns a reason to the model |
| `postToolUse` | The SDK reports a successful tool execution | Log only; do not replace the tool result |
| `postToolUseFailure` | The SDK reports failed tool execution | Log only; preserve the original failure |
| `questionRequested` | A structured user-question interaction has been presented | Notify only; never answer the question |
| `approvalRequested` | A permission or plan-review request has been presented | Notify only; never approve or reject the request |
| `turnEnd` | A complete runtime reply | Log and continue |

Question and approval notifications run after the interaction is visible and do not
block its response. One approval ID is notified once per connection. Failed presentation,
automatic permissions, and headless denials do not trigger these events. Question requests
are distinct from permission requests and do not also fire `approvalRequested`.
`questionRequested` refers to a structured interaction, not question marks in assistant prose.
Currently Claude supplies this interaction through `AskUserQuestion`. Pi and DSH do not
yet expose a general user-question tool in Cherry; their plan-review and permission
requests still fire `approvalRequested`. Adding that question tool is a separate pending change.

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

Limits: 16 Hooks per agent; 60 seconds per command; 1 MiB of JSON input; 64 KiB
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
Drivers receive a Main-only callback, not shell commands or renderer-provided
paths. Claude's prewarmed SDK callbacks resolve the currently bound handler;
DSH transports event data over its authenticated per-connection bridge and relays
cancellation by invocation ID. Reconnecting does not replay completed tool events.
Hooks are not a durable exactly-once job system: a crash can interrupt a command,
and a new runtime connection fires `sessionStart` again.

Regression tests extend the existing runtime, bridge, AgentService, and agent-edit
dialog suites. They cover real command stdin/exit/timeout/cancellation, real SQLite
configuration round trips, real DSH SDK execution, Full Access rejection, warm
Claude callbacks, post-result preservation, and explicit UI re-enabling.
