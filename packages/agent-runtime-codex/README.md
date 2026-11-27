# Codex runtime

Chat opens `CodexSession` from `@cherrystudio/agent-runtime-codex`. The session opens or resumes the native thread, starts and interrupts turns, and translates App Server notifications into incremental text, tool, usage and completion events. It owns model effort and sandbox choices. Interactive requests retain their native request ID. A server withdrawal cancels that request, and turn completion cancels every remaining request for the turn. The host presents command and file approvals, ordinary user questions and MCP forms. Secret questions are declined because the chat form persists answers. URL elicitations are declined. The desktop host supplies the connection, prompts the user, and publishes the resulting session events to Cherry.

## Slash commands

The package exports `listCodexBuiltinCommands()` for unconditional built-ins. A live catalog also includes commands whose native capabilities the session has verified. Each handler defines its name, aliases and argument hint alongside its behavior. Use `session.listCommands()` for the interactive menu. It adds enabled skills discovered through `skills/list` for the current workspace. Built-in names and aliases take precedence. Typing a skill directly also resolves its native path, even before the menu opens. After a menu has been requested, `skills/changed` publishes the refreshed catalog through the session host.

On Codex 0.172.0 and later, interactive sessions discover collaboration modes and the thread’s goals feature in the background. With both Plan and Default modes and a known model, the QuickPanel Plan shortcut selects native Plan with a read-only sandbox. `/plan <task>` uses the same mode, and `/plan off` restores the prior work mode. A goal-enabled thread exposes `/goal` to read, set, pause, resume or clear its objective.

## History and delivery

An existing thread must resume with its original identity. Only an explicitly empty prewarm can restart after Codex reports that exact thread’s rollout missing. Resume requests omit turn contents from Codex 0.125 onward, and fork requests do so from 0.145 onward. Undo reads one descending turn summary from the server and reverts that terminal turn, including an interrupted one. Codex exposes no atomic expected-tail precondition for a concurrent writer.

The session binds a resume target before sending the request and binds a new thread at the response’s wire position. Assistant text carries its native item ID and phase through completion. The host appends terminal-only text once and keeps streamed and adjacent items separate.

Interactive steer carries the active turn ID and product input ID. Only the native user-message echo places the input. Interruption returns an unechoed steer to the user for manual resend. A missing acknowledgment after a disconnect remains unconfirmed. Regular follow-ups use the composer queue.

## App Server client

`CodexSession.launch()` and the launcher used by Settings share the same App Server startup. The
host resolves the selected installation, workspace and environment, then supplies the cross-platform
process operations. The launcher builds the Codex command, fixes the native transport to stdio and
joins shutdown. Explicit wrappers with their own command still connect over their stdio pipes.
Settings checks and model discovery close their processes without opening a native thread.

`@cherrystudio/agent-runtime-codex/app-server-client` connects over an exclusive pair of Node stdio
streams. `ready` resolves after the server acknowledges initialization and the client sends
`initialized`. The launcher closes the transport before joining the process and includes a bounded,
redacted stderr tail on startup failures.

The client associates responses with requests, delivers notifications in wire order, and answers server-initiated requests using their original IDs. An asynchronous approval leaves the reader free to deliver more notifications and responses. Settings can initialize and call `listModels()` without a thread or an approval handler. Unsupported server requests receive the protocol's method-not-found error.

Request parameters for the supported methods are generated from Codex CLI 0.172.0. With that CLI on PATH, run `pnpm --filter @cherrystudio/agent-runtime-codex generate:protocol` to refresh them. Response decoders validate the fields consumed by the runtime. The CLI owns thread storage and tool execution.

[OpenAI App Server protocol](https://developers.openai.com/codex/app-server/) · [Upstream license](./LICENSE-codex)
