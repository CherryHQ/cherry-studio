# Agent Note: Create and edit Agents from a conversation

Status: proposed

English | [中文](2026-11-14-agent-create-in-conversation.zh.md)

## Problem

The built-in Cherry Assistant has a `create_agent` tool (`src/main/ai/mcp/servers/assistant.ts`). Only built-in Agents with host tools mount it; see `src/main/ai/agents/builtin/builtinAgentCapabilities.ts`. The tool falls short in four ways:

- It only sets name, description, instructions, and model.
- It creates a `claude-code` Agent, not the Pi Durable runtime that every create path now uses.
- A conversation cannot change an Agent's configuration at all. The only exception is an Agent's own `mcp__cherry-tools__config` actions: status, rename, channels, and `complete_bootstrap`.
- After a create, the conversation shows only a one-line result (`CreateAgentToolInline`): a generic bot icon, the name, and a button to the chat. It does not show the Agent's avatar, its description, or what was set.

[The purpose-first create flow](2026-11-12-resource-auto-create.md) gives the create wizard and auto create the full set of Agent fields. Cherry Assistant's tool did not follow.

## Proposal

### `create_agent`, extended

`create_agent` creates a Pi Durable Agent with the same fields and safety rules as the create wizard and auto create:

- Fields: emoji avatar, name, description, instructions, model, permission mode, skills, knowledge bases, MCP servers, disabled built-in tools, reply language, and heartbeat.
- The model defaults to the default model.
- The permission mode is never `bypassPermissions`.
- Skill, knowledge base, and MCP server IDs that are not in the installed catalogs are rejected.

It reuses the main-process create path (`createAgent` in `src/main/ai/agents/createAgent.ts`) and the create-command builder `buildCreateAgentCommand`. The builder moves from `src/renderer/utils/resourceCatalog/resourceCreate.ts` to `src/shared/`, so the wizard, auto create, and the tool build the same command.

Channels are out of scope: QR login needs the UI.

### New `update_agent`

`update_agent` takes an Agent ID and a partial set of the same fields. It goes through tool approval every time. The approval shows the current → new value of each field it changes.

Two changes are not allowed through the tool at all: raising the permission mode to `bypassPermissions`, and changing environment variables. The user makes those in the edit dialog.

### New `list_agents`

`list_agents` is read-only. It returns each Agent's ID, name, emoji, description, and model, so the assistant can resolve "that Agent" to an ID.

### Agent identity card

After `create_agent` or `update_agent` succeeds, the tool result renders in the conversation as a card. It replaces `CreateAgentToolInline` in the existing inline result registry.

- The card shows the avatar, name, and description, and a short summary of what was set or changed.
- Clicking the card, or its **Open conversation** button, opens that Agent's conversation.
- **Adjust settings** opens [the paged edit dialog](2026-11-12-resource-edit-pages.md) on its settings page.

### List refresh

The new Agent appears in the Agent list immediately, through the existing DataApi change notifications. No reload is needed.

### Scope

Only the built-in Cherry Assistant gets these tools. Ordinary Agents keep their own `config` tool, and ordinary Assistants get nothing.

## Alternatives considered

- **Give every Agent `create_agent`.** Rejected: it widens what any Agent can do without approval.
- **Apply `update_agent` without approval.** Rejected: the tool can rewrite another Agent's prompt and capabilities, and the user must see each change first.
- **Open the renderer create wizard from chat.** Rejected: a full dialog interrupts the conversation, and the card plus Adjust settings already covers editing.

## Acceptance criteria

- AC1 — `create_agent` creates a Pi Durable Agent with every supplied field, rejects uninstalled skill, knowledge base, and MCP server IDs and the `bypassPermissions` mode, and uses the default model when none is given (verification: main service test; owner: implementer)
- AC2 — `update_agent` asks for approval on every call, the approval lists each changed field with its current and new value, and the tool cannot set `bypassPermissions` or environment variables (verification: main service test and renderer; owner: implementer)
- AC3 — `list_agents` returns the ID, name, emoji, description, and model of every live Agent (verification: main service test; owner: implementer)
- AC4 — After a successful create or update, the conversation shows the identity card, clicking it opens the Agent's conversation, and Adjust settings opens the edit dialog on its settings page (verification: renderer; owner: implementer)
- AC5 — An Agent created from a conversation appears in the Agent list without a reload (verification: renderer; owner: implementer)
- AC6 — Every new UI string exists in all renderer locales without placeholders (verification: docs gate; owner: implementer)
- AC7 — In the running app, asking Cherry Assistant to create an Agent shows the card, and the new Agent appears in the Agent list and opens from the card (verification: Electron; owner: implementer)

## Risks

- The model may pick a poor configuration. Everything stays editable, and only installed resources can be chosen.
- `update_agent` can change another Agent's prompt. Approval is required on every call.
- Approving every update can lead to approval fatigue, where the user approves without reading.
