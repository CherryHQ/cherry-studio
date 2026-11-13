# Agent Note: Profile pane for Assistants and Agents in chat

Status: proposed

English | [中文](2026-11-12-chat-profile-pane.zh.md)

## Problem

In a conversation, the Assistant or Agent the user is talking to has no profile. Clicking its name in the top bar opens the full edit dialog or a picker; clicking its avatar in a message header does nothing. To see what the Assistant knows, which knowledge bases it uses, or what an Agent has produced and has scheduled, the user has to open the edit dialog or other pages. Nothing in the conversation suggests what to ask or what to set up next.

The design prototype (`bot-profile-cherry`) adds a profile pane to the existing right pane slot. It reuses [the paged edit dialog](2026-11-12-resource-edit-pages.md) for full settings.

## Proposal

### Placement and transitions

- The profile pane is a new capability in the existing right pane framework (`src/renderer/components/chat/panes/Shell`), listed first for both Assistant and Agent conversations. It shares the slot with the existing panes; opening another pane replaces it, and clicking the entry of the open pane closes it.
- The Agent session details card and the profile pane are mutually exclusive: opening either closes the other. The card keeps its implemented compact presentation ([Compact Agent session details card](../../implemented/feature/2026-11-08-agent-session-details-card.md)); this Spec only adds the exclusivity, which partially supersedes that note.
- A new `profile` width preset: minimum 300, default 360, maximum 440 pixels, remembered like the other presets.
- Switching between open panes animates the width from one preset to the other and fades the new content in over 150 ms. Hidden panes keep their state.
- The profile pane cannot be maximized. Opening it while another pane is maximized restores the normal layout.
- The pane has no title bar: a fixed blank strip at the top holds only a close button, and the content scrolls below it.

### Entry points

- **Top bar.** The avatar becomes its own button that toggles the profile pane. The name keeps its current action (edit dialog, or picker in an empty conversation).
- **Message header.** The Assistant or Agent avatar in a message header toggles the profile pane for the conversation's current Assistant or Agent. Message headers keep showing the snapshot recorded with each message.

### Content

The top shows a large avatar that can be changed in place, the name, and the description. Below are two tabs: **Activity**, and **Outputs** (Agents only).

**Activity, Assistant:**

- Usage: topics, messages, and tokens in the last 7 days.
- Recent topics: the 5 most recently active topics of this Assistant. A row opens the topic; "All" opens the topic list filtered to this Assistant.
- Linked knowledge bases, with "Manage", which opens the edit dialog's Knowledge bases page.
- Try asking: 4 opening questions generated from the Assistant's name, description, and prompt by the default model, cached until any of them changes. A click fills the composer. "Hide" hides the section for this Assistant.
- Settings: model, browser, and reply language, with "All ›", which opens the edit dialog.

**Activity, Agent:**

- Usage: sessions, task runs in the last 7 days, and tokens in the last 7 days.
- Scheduled tasks: this Agent's tasks with a pause switch; a row opens the task form. "New" fills the composer with a request to create a task.
- Suggestions: only items not done yet — connect Feishu or WeChat when the Agent has no channel, send a daily report when it has no task, connect GitHub when no GitHub MCP server is linked, find skills, remember my habits, and link a knowledge base when none is linked. A click fills the composer, except linking a knowledge base, which opens the edit dialog.
- Workspace: the current session's workspace and whether the Agent is running. A click opens the Files pane.
- Settings: model (with the existing confirmation when the conversation already has messages), permission mode, and reply language, with "All ›".

**Outputs, Agent:** every deliverable the Agent reported across its sessions, filtered by All, Pages, Media, and Files with counts, and grouped by Today, This week, and Earlier. Each row shows a type thumbnail, title, type with source or size, and time. A click opens the file in the Files pane; a deleted file shows as unavailable.

Assistants have no Outputs tab, because Assistants have no deliverable concept.

### Data

- **Usage.** The usage stats endpoint accepts a source filter (Assistant or Agent ID). Topic, message, session, and task-run counts come from small DataApi count queries. "Last 7 days" is a rolling window.
- **Recent topics.** The topics endpoint accepts an Assistant filter and sorts by last activity.
- **Outputs.** A new table indexes deliverables when the `report_artifacts` tool reports them, with Agent, session, path, title, kind, size, and time, exposed through a DataApi list endpoint. Kind is derived from the file type: HTML and Markdown are pages; images, audio, and video are media; everything else is a file. Deliverables reported before this ships are not backfilled.
- **Assistant reply language.** Assistants gain a reply language setting with the same options as Agents, injected into the system prompt the same way. It appears in the profile pane's settings and in the Assistant edit dialog's Answers card.
- **Composer prefill.** A scoped renderer event replaces the composer's draft with the given text and focuses it, in both the Assistant and Agent composers. If the draft is not empty, it is replaced only after the user confirms.

### Edit dialog links

"All", "Manage", and settings rows open the edit dialog on the matching page using the IDs in the edit dialog Spec. The profile pane stays open after the dialog closes, and edits appear in it, the top bar, and the composer immediately.

## Alternatives considered

- **Return Agent session details to a full-height pane in the shared slot.** Undoes a shipped decision; mutual exclusivity gives the one-panel rule without it.
- **Use the existing `inspector` width.** Its 255-pixel minimum is too narrow for the profile content.
- **Keyword-matched opening questions, as in the prototype.** Cheap but generic; generation follows the actual prompt and is cached so it costs one call per change.
- **Show artifacts only from the current session.** That data already exists in session details; the profile is about the Agent across sessions.
- **Drop the reply language row for Assistants.** The prototype puts it in Assistant settings, and the setting is useful on its own.
- **Update past message headers when the profile changes.** That would change `MessageSnapshot`, which is out of scope.

## Acceptance criteria

- AC1 — Clicking the top bar avatar or a message header avatar opens the profile pane for the conversation's Assistant or Agent, and clicking it again closes the pane (verification: renderer; owner: implementer)
- AC2 — Opening another pane replaces the profile pane, opening the profile pane closes the Agent session details card and vice versa, and the profile pane cannot be maximized (verification: renderer; owner: implementer)
- AC3 — The profile pane opens at 360 pixels, resizes between 300 and 440, remembers its width, and switching panes animates the width and fades the content (verification: renderer; owner: implementer)
- AC4 — The Assistant Activity tab shows usage, recent topics, linked knowledge bases, try asking, and settings with the data of that Assistant only (verification: renderer and main service test; owner: implementer)
- AC5 — The Agent Activity tab shows usage, scheduled tasks, suggestions that are not done yet, workspace, and settings with the data of that Agent only (verification: renderer and main service test; owner: implementer)
- AC6 — Usage counts, recent topics, and the 7-day token total match the records of that Assistant or Agent (verification: main service test; owner: implementer)
- AC7 — Try asking shows 4 generated questions, reuses them until the name, description, or prompt changes, and stays hidden for that Assistant after Hide (verification: renderer; owner: implementer)
- AC8 — Clicking a question, a suggestion, or New task puts its text into the composer of the current conversation, and asks before replacing a non-empty draft (verification: renderer; owner: implementer)
- AC9 — A deliverable reported by an Agent appears in its Outputs tab under the right kind and time group, and opens in the Files pane (verification: main service test and renderer; owner: implementer)
- AC10 — An Assistant's reply language set in the profile pane or edit dialog is applied to its replies (verification: main service test; owner: implementer)
- AC11 — All, Manage, and settings rows open the edit dialog on the matching page, and edits made there show in the profile pane without reopening it (verification: renderer; owner: implementer)
- AC12 — Every new UI string exists in all renderer locales without placeholders (verification: docs gate; owner: implementer)
- AC13 — In the running app, the profile pane of one Assistant and one Agent shows real usage, topics or tasks, and Outputs, and its links work (verification: Electron; owner: implementer)

## Risks

- Generating opening questions costs one default-model call per Assistant change, and fails without a default model; the section then stays hidden.
- The outputs index starts empty for existing Agents because older deliverables are not backfilled.
- Usage and count queries run on every profile open; they need indexes on the filtered columns to stay fast with large histories.
- Assistant reply language is a new persisted setting. Existing Assistants must default to no constraint; if the setting needs a new column rather than a settings field, it ships with an appended migration.
- Making the session details card exclusive with the profile pane changes a shipped behavior: the card used to stay open next to any pane.
