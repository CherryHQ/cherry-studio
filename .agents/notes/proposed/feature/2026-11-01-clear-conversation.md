# Agent Note: Clear conversation context on explicit request

Status: proposed

English | [中文](2026-11-01-clear-conversation.zh.md)

## Problem

Every turn resends the whole history up to the last `data-clear` divider, so old topics keep costing tokens and leaking into new answers until the user finds the Ctrl+K divider. The model cannot act on "clear everything above, then …", which is how users naturally ask. Agent sessions have no divider at all. Ctrl+L deletes without stopping a live reply, and queued follow-ups never auto-drain after an abort, so clearing mid-stream stalls the queue.

## Proposal

- Add a built-in `clear_conversation` tool, registered once for Chat (AI-SDK registry) and once on `cherry-tools` for Agents, sharing one main-process core. Its description carries the trigger rules: call only when the user's current message explicitly asks to clear, reset, forget or start over; never for casual uses, questions about the feature, quoted text or vague requests; never on the model's own initiative. Input is `reason` (the user's words) and optional `mode`.
- Divider mode is the default and reuses the existing `data-clear` part. Chat: insert the divider directly above the asking user message and re-link that message under it, so the asking turn survives and the existing divider toggle is the undo. Agent: append a divider row; the runtime resume lookups ignore rows before the latest divider and the warm connection is dropped once the session is idle, so the next turn starts a fresh native transcript. The tool result tells the model to ignore earlier context in the current turn.
- Delete mode never runs inside a turn. The tool broadcasts `ai.conversation.clear_requested`; the renderer shows the existing clear confirmation with the model's reason, and only a confirmed dialog runs the clear.
- One IPC route `ai.conversation.clear` serves Ctrl+L and confirmed deletes for chat and agent-session topics: `abortAndDrain` first, then divider or delete. The renderer kicks the queue head afterwards, since `aborted` never auto-drains. Divider mode shows no dialog; delete always asks.
- Ctrl+K and the eraser while a reply streams enqueue a `clear` action item in the follow-up queue. It runs in order and does not spend the completion, so the message behind it drains on the same completed turn. Agents get Ctrl+K and an eraser toolbar button with the same behaviour.
- Dividers the user did not click into place (model clears, agent dividers) offer a 10-second Undo toast backed by `ai.conversation.undo_clear`.
- Two preferences: `chat.clear_context.default_mode` (`divider` | `delete`, default `divider`) and `chat.clear_context.model_tool_enabled` (default `true`), shown under Context Management.

## Alternatives considered

- External skill or MCP server without app changes: rejected because no gateway or remote route reaches message rows, and an agent's context lives in the runtime transcript that only the app can stop resuming.
- Client-side phrase matching instead of a model tool: rejected because "forget it, let's move on" and "clear my schedule" would clear by mistake; the model decides, and the divider keeps a wrong call reversible.
- Insert the chat divider after the live reply instead of above the asking message: rejected because the history slice would drop the question just answered.
- Let the tool delete directly: rejected because deletion is irreversible and a mid-turn delete races the terminal persist; the renderer dialog gates it.
- Auto-drain the queue on every abort: rejected because stopping a reply is often a deliberate pause; only Ctrl+L kicks the queue.
- Restart the turn with a clean context in the same request: deferred as a separate proposal; the next turn is clean, and the tool result instructs the model for the current one.

## Acceptance criteria

- AC1 — In a chat, "clear everything above, then X" produces a divider directly above that message, the next turn's history starts at it, and clicking the divider restores the previous history. (verification: unit + Electron)
- AC2 — In an agent session, after the model clears, the next connection carries no resume token or native session id from before the divider, and removing the divider row restores them. (verification: unit)
- AC3 — Casual or ambiguous phrases ("clear up what you meant", "forget it", "how do I clear the context?") do not call the tool. (verification: Electron)
- AC4 — A model-requested delete changes nothing until the user confirms a dialog that quotes the model's reason; cancelling leaves the conversation intact. (verification: renderer)
- AC5 — Ctrl+L during a live reply stops it before clearing, asks only in delete mode, and the next queued follow-up sends afterwards. (verification: renderer + unit)
- AC6 — Ctrl+K or the eraser during a live reply adds a queued clear item that runs in order, cannot be edited, and does not block the message queued behind it. (verification: renderer)
- AC7 — Turning off `chat.clear_context.model_tool_enabled` removes the tool from chat requests and from the `cherry-tools` server; Ctrl+L and Ctrl+K keep working. (verification: unit)
- AC8 — Pressing clear twice in an agent session yields one divider, and the Undo toast removes it. (verification: unit + renderer)
- AC9 — All user-visible strings exist in every locale and the i18n gate passes. (verification: docs gate)

## Risks

- The model still sees the pre-clear history during the turn that asked; only the instruction in the tool result keeps it from using it. Mitigated by the divider being visible and reversible.
- Agent follow-ups already queued behind the clearing turn still run on the old transcript, because the reset is applied when the session goes idle.
- The agent reset relies on a per-session pending flag plus scoped DB lookups; a closing-barrier token carried into a new entry must be cleared at connect time, which the implementation does explicitly.
- Direct DataApi callers never see `ai.conversation.cleared`; only the main-window composers offer Undo.
