# Agent Note: Keep Agent slash commands out of Cherry conversation history

Status: proposed

English | [中文](2026-11-28-agent-slash-command-submission.zh.md)

## Problem

The Agent composer sends most slash commands as ordinary chat input. Main reserves a user message and an assistant reply before the runtime can say what the command did, and the composer remembers the command for ArrowUp. The existing direct compaction route avoids those writes. The runtime's `locally-handled` receipt arrives too late to apply this policy consistently.

## Proposal

Use the current session's command catalog to recognize slash invocations from the Agent composer. Use the same lookup for typed and Quick Panel commands. Keep unrecognized text and paths on the normal message route. Revalidate the command and selected session context in Main before execution. If a recognized command becomes unavailable, report failure and keep the draft.

Dispatch before ordinary message admission and before recording input history. The command text stays out of Cherry user messages, input recall, and conversation reference history. Use a command request identity to correlate execution and any native echo. Retain the existing message tree for real replies.

The concrete runtime owns execution. Pi and Pi Durable retain their goal behavior, Codex uses its native controls or turns, and Claude and ACP may transport the command through native user input. Opening that transport is insufficient evidence of model execution. The same command can have different outcomes depending on its arguments or runtime state, so use actual execution evidence instead of a static loop flag. Keep the existing [goal policy](../feature/2026-10-11-agent-runtime-goal.md) and [native compaction contract](../simplification/2026-11-12-native-agent-compaction.md).

Return local command results through feedback. When a command starts model work, preserve its real reply and run lifecycle on the selected branch without adding a user message for the invocation. Reopening the session preserves the reply and excludes native command echo from Cherry projection. Native transcript retention follows the harness protocol.

Retain confirmed native context transitions, including consecutive resets at the same conversation position. A context boundary can carry native binding identity without storing the command text or fabricating a reply.

Use the Agent composer's existing Quick Panel to complete command names at the start of a draft. A command can advertise a structured `subcommands` list in the session catalog. Use those entries to complete the first argument after an exact command, and end subcommand completion when the user begins typing free-form arguments. The runtime that owns a command supplies its candidates. Pi and Pi Durable expose the goal actions they parse, Codex exposes its own goal actions and `/plan off`, and native catalogs without structured candidates still complete the command name.

Tab, Enter on a highlighted candidate, and clicking a candidate insert its text in the draft. The user submits through the existing send action. Completion replaces the active token, preserves text and attachments outside it, and follows existing IME and dismiss behavior.

## Alternatives considered

- Filter command text only in the renderer. This leaves command rows in the product tree and input history and can change which input a later replay treats as conversation.
- Assign each command a static loop flag. The flag cannot describe argument-dependent commands such as Codex `/plan` or prove what a dynamically discovered command did.
- Extract subcommands from the native argument-hint string. Hints can describe arbitrary text or runtime-specific syntax, so parsing them can suggest invocations the runtime never advertised.

## Acceptance criteria

- AC1 — A known command typed or selected in the Agent composer executes without adding a Cherry user message or an ArrowUp entry. Unknown slash text still submits as ordinary text. (verification: renderer and Electron — implementation owner)
- AC2 — Pi and Pi Durable goal controls, native compaction, and Codex control commands retain their effects and report local results without a synthetic conversation reply. (verification: runtime and Main — implementation owner)
- AC3 — Claude and ACP commands still reach their native input interface. A command that produces a model reply remains streamable and readable after reopening, with command echo absent from Cherry history. (verification: native runtime and Main — implementation owner)
- AC4 — A stale command catalog or changed connection cannot send a recognized command as ordinary chat or execute it on a different branch. Rejection leaves the draft available. (verification: Main and renderer — implementation owner)
- AC5 — Consecutive native resets preserve the latest binding for later input and reopen, including when no normal message separates the resets. (verification: Main and native runtime — implementation owner)
- AC6 — A typed prefix such as `/go` completes to the matching catalog command. Choosing a completion changes the draft only, and text outside the active token remains intact. (verification: renderer and Electron — implementation owner)
- AC7 — A space after `/goal` opens the selected runtime's subcommand candidates. Typing `/goal pa` filters them to `pause`, and choosing it leaves `/goal pause` ready to send. Codex excludes Pi's `edit`, `rounds`, and `budget` candidates. (verification: catalog and renderer — implementation owner)
- AC8 — Unknown slash text, a new argument after the first, and a native command without subcommand metadata do not open subcommand completion. Escape preserves the typed draft. (verification: renderer — implementation owner)

## Risks

Ordinary run admission and native input recovery currently link to a saved user message. Command execution must preserve reply ownership, cancellation, branch targeting, and recovery without requiring that message. Native transport acceptance can precede placement. Preserve uncertainty and avoid automatically repeating commands when a connection closes mid-dispatch.

Some subcommands are valid only in particular runtime states. Candidate availability describes the supported syntax. Execution still validates the current state.
