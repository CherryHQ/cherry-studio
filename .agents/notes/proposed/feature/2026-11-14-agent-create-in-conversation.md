# Agent Note: Create and edit Agents from a conversation

Status: proposed

English | [中文](2026-11-14-agent-create-in-conversation.zh.md)

## Problem

The built-in Cherry Assistant has a `create_agent` tool (`src/main/ai/mcp/servers/assistant.ts`). Only built-in Agents with host tools mount it; see `src/main/ai/agents/builtin/builtinAgentCapabilities.ts`. The tool falls short in five ways:

- It only sets name, description, instructions, and model.
- It creates a `claude-code` Agent, not the Pi Durable runtime that every create path now uses.
- A conversation cannot change an Agent's configuration at all. The only exception is an Agent's own `mcp__cherry-tools__config` actions: status, rename, channels, and `complete_bootstrap`.
- It cannot create an Assistant.
- After a create, the conversation shows only a one-line result (`CreateAgentToolInline`): a generic bot icon, the name, and a button to the chat. It does not show the Agent's avatar, its description, or what was set.

[The purpose-first create flow](2026-11-12-resource-auto-create.md) gives the create wizard and auto create the full set of Agent fields. Cherry Assistant's tool did not follow.

## Proposal

### Tools per caller

| Caller | Create an Agent | Create an Assistant | Change Agent settings |
|---|---|---|---|
| Cherry Assistant | `create_agent` | `create_assistant` | `update_agent` (other non-built-in Agents) |
| User-created Agents | `agent_create` | `assistant_create` | `config_update` (itself) |
| Cherry Support and Doctor | none | none | none |

Cherry Support and Doctor get none of these tools: support capabilities intentionally exclude creating Agents, and Doctor runs headless. Assistants themselves still get nothing.

### `create_agent`, extended

`create_agent` and `agent_create` create a Pi Durable Agent with the same fields and safety rules as the create wizard and auto create:

- Fields: emoji avatar, name, description, instructions, model, permission mode, skills, knowledge bases, MCP servers, disabled built-in tools, reply language, and heartbeat.
- The model follows the default model rule below.
- The permission mode is never `bypassPermissions`.
- Skill, knowledge base, and MCP server IDs that are not in the installed catalogs are rejected.

Both reuse the main-process create path (`createAgent` in `src/main/ai/agents/createAgent.ts`) and the create-command builder `buildCreateAgentCommand`. The builder moves from `src/renderer/utils/resourceCatalog/resourceCreate.ts` to `src/shared/`, so the wizard, auto create, and the tools build the same command.

Channels are out of scope: QR login needs the UI.

### New `update_agent`

`update_agent` takes an Agent ID and a partial set of the same fields. It asks for approval on every call, with a preview of each changed field (see Approval).

Two changes are not allowed through the tool at all: raising the permission mode to `bypassPermissions`, and changing environment variables. The user makes those in the edit dialog.

`update_agent` refuses built-in Agents.

### New `config_update`

`config_update` lets a user-created Agent change its own settings. It is a separate tool, not an action on `config`, because approval is decided per tool name:

- `config` keeps its actions (status, rename, channels, and `complete_bootstrap`) and stays approval-free.
- `config_update` asks for approval on every call, with a preview of each changed field (see Approval).

`config_update` covers the avatar emoji, description, instructions, model, permission mode, skills, knowledge bases, MCP servers, disabled built-in tools, reply language, and heartbeat. It has no name field; renaming stays on `config`. It never sets `bypassPermissions` or environment variables. Built-in Agents are refused.

### `agent_list`, extended

No new list tool is added. The existing read-only `agent_list` also returns each Agent's emoji and model, and marks built-in Agents as read-only, so the caller can resolve "that Agent" to an ID and knows which Agents it may not change.

### Assistants from a conversation

`create_assistant` and `assistant_create` create an Assistant. They take emoji, name, description, prompt, model, knowledge bases, MCP servers, web search, and reply language.

- They ask for approval on every call.
- Knowledge base and MCP server IDs that are not in the installed catalogs are rejected.
- The model follows the default model rule below.
- The new Assistant appears in the Assistant list without a reload.

### Approval

Every create and update tool asks for approval, even under Full Access.

For `update_agent` and `config_update`, main computes the change without writing anything, and the approval card shows one current → new line per changed field. A refused change, such as `bypassPermissions`, shows its error before approval instead of a preview.

### Default model

When the call gives no `model`, the tools use:

1. the app's default model, if it can run the new Agent or Assistant;
2. otherwise the calling Agent's model;
3. otherwise an error that asks for `model`.

### Runtime prompt note

Agents that have the create or settings tools get one short line in their prompt: they can create Agents and Assistants and change their own settings, each with user approval.

### Identity card

After a create, an update, or a self-update succeeds, the tool result renders in the conversation as a card. It replaces `CreateAgentToolInline` in the existing inline result registry.

- The card shows the avatar, name, and description, and a short summary of what was set or changed.
- For an Agent, clicking the card, or its **Open conversation** button, opens that Agent's conversation. **Adjust settings** opens [the paged edit dialog](2026-11-12-resource-edit-pages.md) on its settings page.
- For an Assistant, **Open conversation** starts a new topic with it, and **Adjust settings** opens the Assistant edit dialog.
- A self-update's card hides **Open conversation**, because the user is already in that conversation. It keeps **Adjust settings**.

### List refresh

A new Agent appears in the Agent list immediately, through the existing DataApi change notifications. No reload is needed.

## Alternatives considered

- **Keep Agent creation to Cherry Assistant.** Rejected: every call needs approval and goes through the same validation, so giving `agent_create` to every user-created Agent adds no change the user has not seen first.
- **Add self-update as a `config` action.** Rejected: approval is decided per tool name, so it would either make status, rename, and channel changes ask for approval or let a self-update skip it.
- **Add a new `list_agents` tool.** Rejected: `agent_list` already lists Agents; it only needed emoji, model, and the read-only flag.
- **Apply a self-update without approval.** Rejected: an Agent could rewrite its own prompt and permission mode, and the user must see each change first.
- **Apply `update_agent` without approval.** Rejected: the tool can rewrite another Agent's prompt and capabilities, and the user must see each change first.
- **Open the renderer create wizard from chat.** Rejected: a full dialog interrupts the conversation, and the card plus Adjust settings already covers editing.

## Acceptance criteria

- AC1 — `create_agent` and `agent_create` create a Pi Durable Agent with every supplied field, reject uninstalled skill, knowledge base, and MCP server IDs and the `bypassPermissions` mode, and apply the default model rule when no model is given; a user-created Agent can call `agent_create`, and the new Agent appears in the Agent list (verification: main service test and renderer; owner: implementer)
- AC2 — `update_agent` asks for approval on every call, the approval lists each changed field with its current and new value before anything is written, the tool cannot set `bypassPermissions` or environment variables, and it refuses built-in Agents (verification: main service test and renderer; owner: implementer)
- AC3 — `agent_list` returns the ID, name, emoji, description, and model of every live Agent and marks built-in Agents as read-only (verification: main service test; owner: implementer)
- AC4 — After a successful create or update, the conversation shows the identity card, clicking it opens the Agent's conversation, and Adjust settings opens the edit dialog on its settings page (verification: renderer; owner: implementer)
- AC5 — An Agent created from a conversation appears in the Agent list without a reload (verification: renderer; owner: implementer)
- AC6 — Every new UI string exists in all renderer locales without placeholders (verification: docs gate; owner: implementer)
- AC7 — In the running app, asking Cherry Assistant to create an Agent shows the card, and the new Agent appears in the Agent list and opens from the card (verification: Electron; owner: implementer)
- AC8 — A user-created Agent's `config_update` asks for approval on every call while `config` stays approval-free, shows each changed field's current → new value, refuses `bypassPermissions`, environment variables, and any call from a built-in Agent, and the change appears in the edit dialog (verification: main service test and renderer; owner: implementer)
- AC9 — `create_assistant` and `assistant_create` create an Assistant with every supplied field, reject unknown IDs, ask for approval, and the Assistant appears in the Assistant list and opens from the identity card (verification: main service test and renderer; owner: implementer)

## Risks

- The model may pick a poor configuration. Everything stays editable, and only installed resources can be chosen.
- `update_agent` can change another Agent's prompt. Approval is required on every call.
- An Agent can change its own prompt or permission mode. Approval is required on every call, and the mode is never `bypassPermissions`.
- Creating from any Agent can lead to many Agents and Assistants. Every create needs approval, and the user can delete them.
- Approving every update can lead to approval fatigue, where the user approves without reading.
