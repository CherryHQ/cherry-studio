# Agent Note: Agent quick create and profile

Status: proposed

English | [中文](2026-10-30-agent-quick-create-and-profile.zh.md)

## Problem

Creating an Agent takes a four-step wizard: users choose a runtime, a permission mode, and a model, write a system prompt (or press "Generate"), and pick skills and knowledge bases before anything exists. Most users only know what they want the Agent to do, so they either stall on the wizard or end up with an Agent that lacks the skills its job needs. Opening an existing Agent drops straight into a tabbed form, so its identity and scheduled tasks are never the first thing shown, and the tab rail spreads its configuration across eight pages.

The 2026-10-29 community sync decided: an Agent should be usable from a name and a purpose; configuration should be automatic for most users and still reachable for the rest; the runtime choice goes away now that Pi is the default; and opening an Agent should show a profile before its settings. Pi Durable, a durable variant of Pi added to `main` after the meeting, became the runtime for new Agents (decided 2026-11-04).

## Proposal

- **Quick create.** Agent creation opens a single page with the avatar, a name field, and a purpose field. A primary "Agent create" button and a secondary "Manual create" button are enabled once a name exists and a model is resolved. The usable default model is preselected silently; only when none exists does the page show a model picker with a prompt to choose one. Assistant creation is unchanged.
- **Manual create.** "Manual create" opens the existing guided wizard with the avatar, name, description (from purpose), and system prompt (from purpose) prefilled, and a "Back to quick create" action that keeps what was typed. The wizard no longer offers a runtime or permission-mode choice: every new Agent uses Pi Durable with the runtime's default permission mode, which stays editable in More settings. Existing Pi and Claude Agent SDK Agents keep working and show their runtime read-only.
- **Agent create.** "Agent create" runs inside the same dialog with visible progress:
  1. Generate a system prompt from the name and purpose with the selected model. If generation fails, the purpose (or the name) becomes the prompt.
  2. Enable every installed skill; built-in tools stay fully enabled (an empty `disabledTools`).
  3. Ask the selected model for marketplace search terms, search the existing skill registries, let the model choose at most two relevant results, install them, and enable them for the new Agent. Search, choice, or install failures are shown in the progress view and never block creation.
  The Agent is then created through the existing `ai.agent.create` command.
- **After creation.** Both create paths, from the library and from the Agent page, land on the new Agent's profile card; the Agent page still opens the new Agent's conversation underneath. When part of the automatic setup fell back (prompt generation or a skill install failed), the card says so and points to More settings.
- **Profile card.** Opening an Agent (library, global search, the composer's Agent label) shows a profile card: avatar, name, main model, enabled skill and tool counts, description, and the Agent's scheduled tasks from `GET /agents/:id/tasks`, each showing its last run ("Last run succeeded/failed") or, before a first run or while paused or missed, its status (an empty state when there are none; a new Agent never has tasks). The endpoint's items gain the same `runSummary` the global task list already returns, so the Agent's own "list tasks" tool sees it too. It offers "More settings" and "Start chat"; "Start chat" opens the Agent through the existing `/app/agents?agentId=` route. Explicit "Edit" actions (context menus, the selector's edit button) and deep links skip the card and open the settings.
- **More settings.** The settings open on one scrolling page of compact label-and-control rows in five groups (basic info, model, capabilities, behavior, other) instead of a tab rail. Avatar and name, description, models, read-only runtime, permission mode, reply language, and heartbeat are edited in place. Built-in tools, skills, MCP servers, and knowledge bases are rows showing an enabled count that open a searchable list of switches in place; each list keeps the links of its old page (browser and computer-use settings, "add more skills", MCP settings, legacy-restriction removal). The system prompt, prompt bindings, and environment variables keep their existing editors on a sub-page, and the heartbeat task keeps its existing editor dialog. Existing deep links open the matching list (`tools.skills`, `tools.mcp`, …) or sub-page. Every setting of the previous dialog stays available; returning to the profile card saves pending edits first.
- Avatars stay emoji in this work; image avatars are a separate change.

## Alternatives considered

- Keep the wizard and add an "auto-fill" button: rejected because it keeps the runtime/model/prompt decisions in front of the users who do not want them.
- Generate the configuration after creation in the background: rejected because the user would chat with a half-configured Agent and could not see what was added.
- Return to the conversation after creation without the profile card: rejected; the card is where the user checks what "Agent create" configured and learns about anything that fell back.
- Ship only curated skills for automatic install: preferred long term, but no curated skill source exists on `main`; automatic install uses the existing registries with a hard limit of two skills and a visible list of what was installed.
- Restyle the existing tab rail instead of a grouped page: rejected because the rail itself is the complexity being removed.
- Keep every multi-select editor (skill catalog, MCP grid, knowledge picker) on its own sub-page: rejected; a sub-page per list hides what is enabled behind navigation, while an in-place list of switches writes the same form fields and reuses the dialog's save path. Prompt bindings keep a sub-page because they need more than on/off.
- Send explicit "Edit" actions through the profile card: rejected because it adds a click to an action that already states its intent.

## Acceptance criteria

- AC1 — Agent creation opens a page with avatar, name, and purpose; "Agent create" and "Manual create" stay disabled until a name exists and a model is resolved, and a model picker with a prompt appears only when no usable default model exists. (verification: renderer)
- AC2 — "Manual create" opens the guided wizard prefilled with avatar, name, description, and system prompt from the quick-create page, offers no runtime or permission-mode choice, can go back to quick create, and creates a Pi Durable Agent. (verification: renderer)
- AC3 — "Agent create" shows progress, creates a Pi Durable Agent whose system prompt is generated from the name and purpose, enables every installed skill, and leaves all built-in tools enabled; when generation fails the Agent is still created with the user's input. (verification: unit + renderer)
- AC4 — "Agent create" installs and enables at most two marketplace skills chosen for the purpose and lists them in the progress view; search, choice, or install failures are shown without blocking creation. (verification: unit + renderer)
- AC5 — Opening an Agent shows a profile card with avatar, name, model, description, and its scheduled tasks with their last run or status, or an empty state; "Start chat" opens the Agent and "More settings" opens its settings, while explicit Edit actions and deep links open the settings directly. Creating an Agent from either path lands on its profile card, which flags an automatic setup that fell back. (verification: unit + renderer + Electron)
- AC6 — More settings is one grouped page without a tab rail exposing every setting of the previous edit dialog; built-in tools, skills, MCP servers, and knowledge bases open searchable switch lists in place, `tools.skills` / `tools.mcp` deep links open the matching list, and returning to the profile card saves pending edits. (verification: renderer + Electron)
- AC7 — Existing Pi and Claude Agent SDK Agents open, show their runtime read-only, and keep every setting editable. (verification: renderer)

## Risks

- Automatic install runs third-party skills from community registries without a per-skill confirmation. The limit of two, the visible install list, and removal from More settings bound the exposure; a curated source should replace the open registries when it exists.
- Model calls add latency to "Agent create"; each step has a timeout and falls back so creation always completes.
- The grouped settings page re-hosts every existing field; a missing field is a silent regression, so AC6 is verified against the previous tab list.
