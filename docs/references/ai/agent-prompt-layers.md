---
description: Precedence and lifecycle of agent prompt sources — System Prompt, workspace system.md, SOUL.md persona, and variables
sources:
  - src/main/ai/runtime/agentPrompt.ts
  - src/main/ai/runtime
  - src/main/ai/runtime/claudeCode/settingsBuilder.ts
  - src/main/ai/runtime/claudeCode/identityHooks.ts
  - src/main/ai/runtime/pi/identityExtension.ts
  - src/main/ai/agents/prompt.ts
  - src/main/ai/agents/bootstrap.ts
  - src/main/ai/mcp/servers/agentMemory.ts
  - src/main/ai/agentSession/AgentSessionRuntimeService.ts
---

# Agent Prompt Layers

Agent conversations combine several independently stored prompt sources. They are not synchronized because each source has a different scope and lifecycle.

## Source contract

| Priority | Source | Storage | Scope and lifecycle |
|---:|---|---|---|
| 1 | Platform and runtime safety constraints | Application and runtime code | Non-overridable runtime policy; materialized with the connection |
| 2 | Agent System Prompt | `agent.instructions` in Agent configuration | Authoritative role, goals, capability scope, and behavioral constraints; applies from the next fresh model turn after save |
| 3 | Workspace Instructions | `<workspace>/system.md` plus runtime-native `CLAUDE.md` / scoped `AGENTS.md` context | Workspace-local guidance; an explicit `system.md` replaces the runtime's native base, including when the file is empty |
| 4 | Agent Persona | `<agent-data>/SOUL.md` | Persistent name, personality, tone, and communication style across workspaces |

Lower-priority guidance still applies when it does not conflict with a higher-priority source. `USER.md`, `memory/FACT.md`, journal entries, and retrieved knowledge are context rather than behavioral authority. This hierarchy is injected only when `agent.instructions` resolves to non-blank content. Agents without a configured System Prompt retain the legacy role-discovery and role-bearing `SOUL.md` fallback instead of receiving a hierarchy that points to a missing authority source.

The hierarchy is an explicit instruction contract provided to the model, not a deterministic enforcement or security boundary; application and runtime hooks independently enforce hard runtime and tool-safety constraints. Prompt composition still preserves existing workspace and `SOUL.md` content verbatim. This change does not structurally remove legacy role text, so resolving conflicts remains model-mediated rather than guaranteed.

## System Prompt authoring

Assistant and Agent editors both call the field **System Prompt** and expose variable insertion, resolved preview, generation, and polishing. Their storage and runtimes remain different: Assistant stores `assistant.prompt`; Agent stores `agent.instructions`. The editor's resolved preview is display-only: unresolved source text is persisted, and Main resolves it independently when materializing a connection.

For Agents, `buildAgentRuntimePrompt` resolves a non-blank configured System
Prompt and wraps it in `<agent_instructions>` for every registered runtime.
Workspace and persona content remain present, but they cannot redefine the
Agent role. When the configured value is blank, neither that wrapper nor the
precedence hierarchy is injected.

## Workspace Instructions

An explicit `system.md` selects a custom base across runtimes; an empty file
deliberately selects an empty custom base. Each driver maps the common
`{ base, append }` result into its SDK: Claude Code uses its preset/custom base,
Pi uses system/append overrides. Runtime-
native workspace context can still load according to that driver's trust
boundary. Cherry-owned persona, memory, workspace-path, security, citation,
artifact, and language guidance is appended independently of the base.

## Persona and onboarding

Creating an Agent preserves an empty System Prompt; it does not supply a generic
role. Having a configured System Prompt selects the kind of onboarding, not
whether onboarding is complete. `bootstrap_completed: true` skips onboarding,
`false` explicitly restarts it, and an absent flag uses substantial existing
`SOUL.md` content as the legacy completion signal.

`SOUL.md` is not a replica of Agent configuration. With a configured System Prompt, bootstrap may create or edit it only to record the Agent's name, personality, tone, and communication style; it must not discover, restate, or replace the configured role. Without a configured System Prompt, bootstrap preserves the legacy flow and may discover and store the role in `SOUL.md`. Bootstrap records user context in `USER.md` in both modes.

Saving Agent configuration never writes `SOUL.md`, and editing `SOUL.md` never writes `agent.instructions`. Existing custom files are preserved.

The memory context tells the Agent to apply its loaded persona in replies and
introductions, personalize responses with the user profile, and consult durable
facts when recalling decisions. The stable system prompt supplies the identity
application rules and absolute storage paths; mutable file contents are loaded by runtime hooks.

The `agent-memory` MCP server owns memory tool instructions: updating durable
facts, appending events, and searching journal history. Each runtime connection
gets an in-process protocol instance bound to its Agent's storage. Disabling
Memory unmounts this server and its instructions; it does not disable the
SOUL.md, USER.md, or existing FACT.md snapshots. Pi exposes full MCP instructions
through native namespace discovery, so basic identity application rules remain
in the stable prompt independently of MCP discovery.

Before each new turn, the harness checks `SOUL.md`, `USER.md`, and `memory/FACT.md`
in Agent storage and delivers a complete `<agent_identity>` snapshot. This does
not depend on the model choosing a Read tool or a skill. Creation, edits,
clearing, and deletion take effect on the next turn of a reused connection.
Empty sections explicitly withdraw previous contents, including those preserved
in conversation summaries. The latest snapshot remains subordinate to the Agent
System Prompt and current user instructions.

Claude Code supplies identity through `UserPromptSubmit.additionalContext`,
deduplicated per connection, and reloads it through `SessionStart` after native
compaction or session restoration. Pi updates the `agent_identity` system section
in `before_agent_start`; its native section diffing preserves unchanged context
and replaces changed content. Neither path rebuilds a connection solely because
an identity file changed. Changes made during an active turn are picked up at the
next turn boundary; workspace prompt files retain their existing lifecycle.

## Update and variable lifecycle

Saving `agent.instructions` invalidates the connection rebuild signature. Changes to `app.user.name` and the Agent's resolved primary model name also invalidate it because they affect `{{username}}` and `{{model_name}}`. An idle stale connection closes eagerly; a live response finishes with its captured prompt; the next fresh model turn rebuilds and sees the saved value.

System Prompt variables are resolved by `buildAgentRuntimePrompt` when an Agent
runtime connection is created or rebuilt. `{{model_name}}` uses the Agent's
resolved primary model name. Volatile values such as `{{date}}`, `{{time}}`,
and `{{datetime}}` remain connection snapshots until another rebuild; they do
not force a rebuild every turn.

## Implementation map

- `src/main/ai/runtime/agentPrompt.ts` owns shared precedence, variable materialization, and the `{ base, append }` contract.
- Runtime drivers under `src/main/ai/runtime/{claudeCode,pi}/` map that contract into their SDK/composition.
- `src/main/ai/agents/prompt.ts` owns workspace base selection and persona/memory context.
- `src/main/ai/runtime/claudeCode/identityHooks.ts` and `src/main/ai/runtime/pi/identityExtension.ts` deliver live identity through native runtime hooks.
- `src/main/ai/agents/bootstrap.ts` owns first-run persona and user onboarding guidance.
- `src/main/ai/agentSession/AgentSessionRuntimeService.ts` owns next-turn connection reconciliation.
