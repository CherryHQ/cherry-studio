# Agent Note: Agent quick create and profile

Status: proposed

English | [中文](2026-10-30-agent-quick-create-and-profile.zh.md)

## Problem

Creating an Agent takes a four-step wizard: users choose a runtime, a permission mode, and a model, write a system prompt (or press "Generate"), and pick skills and knowledge bases before anything exists. Most users only know what they want the Agent to do, so they either stall on the wizard or end up with an Agent that lacks the skills its job needs. Opening an existing Agent drops straight into a tabbed form, so its identity and scheduled tasks are never the first thing shown, and the tab rail spreads its configuration across eight pages.

The 2026-10-29 community sync decided: an Agent should be usable from a name and a purpose; configuration should be automatic for most users and still reachable for the rest; the runtime choice goes away now that Pi is the default; and opening an Agent should show a profile before its settings.

## Proposal

- **Quick create.** Agent creation opens a single page with the avatar, a name field, and a purpose field. A primary "Agent create" button and a secondary "Manual create" button are enabled once a name exists and a model is resolved. The usable default model is preselected silently; only when none exists does the page show a model picker with a prompt to choose one. Assistant creation is unchanged.
- **Manual create.** "Manual create" opens the existing guided wizard with the avatar, name, description (from purpose), and system prompt (from purpose) prefilled. The wizard no longer offers a runtime choice; every new Agent uses Pi. Existing Claude Agent SDK Agents keep working and show their runtime read-only.
- **Agent create.** "Agent create" runs inside the same dialog with visible progress:
  1. Generate a system prompt from the name and purpose with the selected model. If generation fails, the purpose (or the name) becomes the prompt.
  2. Enable every installed skill; built-in tools stay fully enabled (an empty `disabledTools`).
  3. Ask the selected model for marketplace search terms, search the existing skill registries, let the model choose at most two relevant results, install them, and enable them for the new Agent. Search, choice, or install failures are shown in the progress view and never block creation.
  The Agent is then created through the existing `ai.agent.create` command, and the caller keeps its current post-create behavior.
- **Profile card.** Opening an Agent (library, global search, the composer's Agent label) shows a profile card: avatar, name, main model, enabled skill and tool counts, description, and the Agent's scheduled tasks from `GET /agents/:id/tasks` with their status (an empty state when there are none; a new Agent never has tasks). It offers "More settings" and "Start chat"; "Start chat" opens the Agent through the existing `/app/agents?agentId=` route. Explicit "Edit" actions (context menus, the selector's edit button) and deep links skip the card and open the settings.
- **More settings.** The settings open on one scrolling page instead of a tab rail. The basic fields (avatar and name, description, read-only runtime, models, permission mode, reply language, heartbeat) are edited in place. The system prompt, built-in tools, knowledge bases, MCP servers, skills, prompt bindings, and environment variables are rows with a value summary that open their existing editors on a sub-page; built-in tools and MCP servers gain a search box, while skills, knowledge bases, and prompt bindings keep their existing search. Existing deep links (`tools.skills`, `tools.mcp`, …) open the matching sub-page. Every setting of the previous dialog stays available; returning to the profile card saves pending edits first.
- Avatars stay emoji in this work; image avatars are a separate change.

## Alternatives considered

- Keep the wizard and add an "auto-fill" button: rejected because it keeps the runtime/model/prompt decisions in front of the users who do not want them.
- Generate the configuration after creation in the background: rejected because the user would chat with a half-configured Agent and could not see what was added.
- Land on the profile card after creation: deferred; callers already route the new Agent into a conversation, and the progress view shows what was configured.
- Ship only curated skills for automatic install: preferred long term, but no curated skill source exists on `main`; automatic install uses the existing registries with a hard limit of two skills and a visible list of what was installed.
- Restyle the existing tab rail instead of a grouped page: rejected because the rail itself is the complexity being removed.
- Edit multi-select settings in popovers on the main page: rejected for now; the existing editors (skill catalog, MCP grid, knowledge picker, prompt bindings) need more room than a popover, and re-implementing them would duplicate their save and validation logic.
- Send explicit "Edit" actions through the profile card: rejected because it adds a click to an action that already states its intent.

## Acceptance criteria

- AC1 — Agent creation opens a page with avatar, name, and purpose; "Agent create" and "Manual create" stay disabled until a name exists and a model is resolved, and a model picker with a prompt appears only when no usable default model exists. (verification: renderer)
- AC2 — "Manual create" opens the guided wizard prefilled with avatar, name, description, and system prompt from the quick-create page, offers no runtime choice, and creates a Pi Agent. (verification: renderer)
- AC3 — "Agent create" shows progress, creates a Pi Agent whose system prompt is generated from the name and purpose, enables every installed skill, and leaves all built-in tools enabled; when generation fails the Agent is still created with the user's input. (verification: unit + renderer)
- AC4 — "Agent create" installs and enables at most two marketplace skills chosen for the purpose and lists them in the progress view; search, choice, or install failures are shown without blocking creation. (verification: unit + renderer)
- AC5 — Opening an Agent shows a profile card with avatar, name, model, description, and its scheduled tasks or an empty state; "Start chat" opens the Agent and "More settings" opens its settings, while explicit Edit actions and deep links open the settings directly. (verification: renderer + Electron)
- AC6 — More settings is one page without a tab rail exposing every setting of the previous edit dialog; built-in tools, skills, MCP servers, knowledge bases, and prompt bindings open searchable sub-pages, `tools.skills` / `tools.mcp` deep links open the matching sub-page, and returning to the profile card saves pending edits. (verification: renderer + Electron)
- AC7 — Existing Claude Agent SDK Agents open, show their runtime read-only, and keep every setting editable. (verification: renderer)

## Risks

- Automatic install runs third-party skills from community registries without a per-skill confirmation. The limit of two, the visible install list, and removal from More settings bound the exposure; a curated source should replace the open registries when it exists.
- Model calls add latency to "Agent create"; each step has a timeout and falls back so creation always completes.
- The grouped settings page re-hosts every existing field; a missing field is a silent regression, so AC6 is verified against the previous tab list.
