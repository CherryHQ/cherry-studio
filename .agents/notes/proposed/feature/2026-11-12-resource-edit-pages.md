# Agent Note: Paged edit dialog for Agents and Assistants

Status: proposed

English | [中文](2026-11-12-resource-edit-pages.zh.md)

## Problem

The Agent and Assistant edit dialogs (`src/renderer/components/resourceCatalog/dialogs/edit/AgentEditDialog.tsx`, `AssistantEditDialog.tsx`) share `EditDialogShell`, a wide dialog with a left rail of tabs. Every setting sits at the same depth: the basics, the System Prompt, tools, skills, knowledge, MCP, prompt bindings, memory, and advanced parameters. The user cannot tell which settings matter, the dialog shows rarely used fields such as runtime, plan model, and small model next to the name, and some Agent settings are not in the dialog at all. IM channels live only in global Settings, and an Agent's scheduled tasks live only on the scheduled-tasks page.

The design prototype (`bot-profile-cherry`) replaces the rail with a narrow paged dialog. [The create flow](2026-11-12-resource-auto-create.md) reuses the same capability lists and the full System Prompt preview, and [the chat profile pane](2026-11-12-chat-profile-pane.md) deep-links into these pages.

## Proposal

### Paged shell

The edit dialog becomes a narrow dialog with a page stack and a back button. The main page is the entry; "More settings" lists grouped cards; each capability opens a sub-page. Back from a sub-page returns to More settings, and back from More settings returns to the main page. The dialog keeps the existing autosave (500 ms debounce), the flush on close, and name validation. Avatars, channels, tasks, heartbeat tasks, and memory keep saving immediately through their existing IPC and DataApi calls.

### Main page

- A large centred avatar. Clicking it opens the existing avatar picker, which keeps image upload.
- The name as large borderless text, and a one-line description below it. Both get a light background on hover and focus, and an empty name still shows the required-field message.
- One row with the model as a chip and a "More settings ›" link.

The runtime row is removed. The plan and small model fields are removed; changing the model clears both, so they follow the main model.

### More settings: Agent

Cards, each with rows that show the name on the left and the control or a summary on the right:

- **Capabilities.** Built-in tools ›, Skills ›, Knowledge bases ›, MCP servers ›, Channels ›, Scheduled tasks ›. Each row shows `Enabled X / Y`; knowledge bases show `Linked X / Y`.
- **Run.** Permission mode and reply language.
- **Heartbeat.** The heartbeat switch; when on, interval and maximum run time; and "Edit heartbeat tasks", which shows how many tasks the heartbeat document holds.
- **Advanced.** System Prompt › (filled or not filled), Memory ›, and environment variables.

Counting rules: built-in tools count the runtime's tools after knowledge-tool gating and exclude browser control and computer use; skills count builtin skills as enabled; MCP excludes the browser server; scheduled tasks count only active tasks.

### More settings: Assistant

- **Capabilities.** Knowledge bases ›, the MCP mode (auto, manual, disabled) with an "MCP servers ›" row when manual, and browser.
- **Answers.** Temperature, Top-P, and max tokens, each a switch that reveals its slider or input; streaming; maximum tool calls; custom context › (message count and the existing compression and truncation settings); and custom parameters ›.
- **Advanced.** System Prompt › and group.

### Sub-pages

- **System Prompt.** For Agents on Pi Durable, the full System Prompt preview defined in the create flow Spec, with only the Agent's instructions editable. For other runtimes and for Assistants, the existing prompt editor with generate, polish, preview, and variables.
- **Built-in tools, Skills, Knowledge bases, MCP servers.** The shared capability lists from the create flow Spec. Builtin skills are locked on.
- **Channels (Agent).** The channels bound to this Agent, each with platform icon, name, connection state, a one-line summary, edit, delete, and an active switch. "Add channel" lists every supported platform. The configuration dialog reuses the existing channel forms, binds the channel to this Agent, and hides the Agent picker. QR login runs inside the dialog. Settings › Channels stays as the global view.
- **Scheduled tasks (Agent).** This Agent's tasks with a pause switch, schedule summary, and last run. "New task" and each row open the existing task form with the Agent fixed; editing also shows run history, Run now, and Delete.
- **Memory (Agent).** The existing memory panel. Leaving it with unsaved edits asks for confirmation, as switching tabs does today.

### Reply language

One select replaces the segmented control and combobox: follow the global setting (showing its value, or "Follow conversation language" when the global value is empty), no constraint, the preset languages, and "Other language…", which reveals a single-line input of 1–50 characters. It writes the existing `languageMode` / `languageCustom` mapping. The same component is used in the create flow.

### Removed

- The runtime row and the plan and small model fields.
- The prompt bindings tab. Bindings keep working in the composer; the composer's "manage current" entry is removed, and its existing "manage all" entry opens Settings › Prompts.

### Deep links

The existing `initialTab` IDs keep working and open the matching page: `basic` the main page; `prompt` System Prompt; `tools.builtin` built-in tools (Assistants: More settings); `tools.skills` Skills; `tools.knowledge` Knowledge bases; `tools.mcp` MCP servers (Assistants: More settings); `advanced` More settings; `memory` Memory. New IDs `channels` and `tasks` open those sub-pages, so the Agent list's "Connect to IM…" entry from the channel-binding proposal lands on Channels.

### Relation to the channel-binding proposal

[Agent-scoped IM channel binding entry points](2026-11-08-agent-channel-binding-entry-points.md) proposes a per-platform on/off toggle in a Channels tab. This Spec partially supersedes it: the Agent's Channels page is a list of bound channels with full configuration instead of one toggle per platform, so an Agent can have two channels of one platform and can activate a channel without leaving the dialog. Its Agent list menu entry, its unchanged global Settings › Channels, and its single creation code path stay.

## Alternatives considered

- **Restyle the existing rail.** Keeps every setting at one depth, which is the problem.
- **Keep runtime, plan model, and small model as advanced fields.** They are rarely changed; the product is moving to one model per Agent and no runtime choice. Data stays, so a later decision can bring them back.
- **Drop the Assistant fields the prototype does not draw** (maximum tool calls, custom parameters, compression and truncation). They are in use; nesting them keeps the main surfaces short without removing capability.
- **Per-platform channel toggles.** See the relation above.
- **Keep the workspace field in the Agent-scoped task form.** The task schema requires a workspace, so the form keeps the field with the system workspace as default.

## Acceptance criteria

- AC1 — Opening an Agent or Assistant edit dialog shows the main page with avatar, name, description, model chip, and More settings, without runtime, plan model, or small model fields (verification: renderer; owner: implementer)
- AC2 — More settings shows the grouped cards for each kind, sub-pages open from their rows, and back returns to the previous page without closing the dialog (verification: renderer; owner: implementer)
- AC3 — Capability rows show `Enabled X / Y` (`Linked X / Y` for knowledge bases) computed with the counting rules in this Spec (verification: renderer; owner: implementer)
- AC4 — Edits on any page autosave, closing the dialog flushes pending edits, and an empty name is never saved (verification: renderer; owner: implementer)
- AC5 — Changing an Agent's model clears its plan and small models (verification: unit; owner: implementer)
- AC6 — The Channels page lists only this Agent's channels, a channel added there is bound to this Agent, and toggling or deleting it updates the global Settings › Channels view (verification: renderer and Electron; owner: implementer)
- AC7 — The Scheduled tasks page lists only this Agent's tasks, pausing and resuming updates the task, and the task form opened there has the Agent fixed and offers run history, Run now, and Delete when editing (verification: renderer; owner: implementer)
- AC8 — The reply language select writes inherit, off, a preset, or a custom language, and the custom input appears only for "Other language…" (verification: renderer; owner: implementer)
- AC9 — The prompt bindings tab is gone, and the composer offers no "manage current" entry while its "manage all" entry opens Settings › Prompts (verification: renderer; owner: implementer)
- AC10 — Every existing `initialTab` ID and the new `channels` and `tasks` IDs open the page this Spec maps them to (verification: renderer; owner: implementer)
- AC11 — Leaving the Memory page with unsaved edits asks for confirmation (verification: renderer; owner: implementer)
- AC12 — Every new UI string exists in all renderer locales without placeholders (verification: docs gate; owner: implementer)
- AC13 — In the running app, an Agent edited through every sub-page keeps its changes after the app restarts (verification: Electron; owner: implementer)

## Risks

- The edit dialog tests depend heavily on tab IDs and need a large rewrite.
- Agents with distinct plan or small models keep them until their model changes; nothing in the UI shows them.
- Moving channel management into the Agent duplicates part of Settings › Channels. Both use one channel form component so they cannot drift.
- Removing the prompt bindings tab leaves existing bindings without a per-target management view. The implementation layer must confirm how a binding is removed afterwards, or keep a minimal removal path in the composer.
