# Agent Prompt Layers

Agent conversations combine several independently stored prompt sources. They are not synchronized because each source has a different scope and lifecycle.

## Source contract

| Priority | Source | Storage | Scope and lifecycle |
|---:|---|---|---|
| 1 | Platform and runtime safety constraints | Application and runtime code | Non-overridable runtime policy; materialized with the connection |
| 2 | Agent System Prompt | `agent.instructions` in Agent configuration | Authoritative role, goals, capability scope, and behavioral constraints; applies from the next fresh model turn after save |
| 3 | Workspace Instructions | `<workspace>/system.md` | Workspace-local guidance; when present, it replaces the Claude Code preset base, including when the file is empty |
| 4 | Agent Persona | `<agent-data>/SOUL.md` | Persistent name, personality, tone, and communication style across workspaces |

Lower-priority guidance still applies when it does not conflict with a higher-priority source. `USER.md`, `memory/FACT.md`, journal entries, and retrieved knowledge are context rather than behavioral authority. This hierarchy is injected only when `agent.instructions` resolves to non-blank content. Agents without a configured System Prompt retain the legacy role-discovery and role-bearing `SOUL.md` fallback instead of receiving a hierarchy that points to a missing authority source.

The hierarchy is an explicit instruction contract provided to the model, not a deterministic enforcement or security boundary; application and runtime hooks independently enforce hard runtime and tool-safety constraints. Prompt composition still preserves existing workspace and `SOUL.md` content verbatim. This change does not structurally remove legacy role text, so resolving conflicts remains model-mediated rather than guaranteed.

## System Prompt authoring

Assistant and Agent editors both call the field **System Prompt** and expose variable insertion, resolved preview, generation, and polishing. Their storage and runtimes remain different: Assistant stores `assistant.prompt`; Agent stores `agent.instructions`. The editor's resolved preview is display-only: unresolved source text is persisted, and Main resolves it independently when materializing a connection.

For Agents, a non-blank configured System Prompt is wrapped in `<agent_instructions>` when the Claude Code connection is built. Workspace and persona content remain present, but they cannot redefine the Agent role. When the configured value is blank, neither that wrapper nor the precedence hierarchy is injected.

## Workspace Instructions

An explicit `system.md` keeps its existing base-selection behavior. Its presence replaces the Claude Code preset base; an empty file deliberately selects an empty custom base. Cherry-owned persona, memory, workspace-path, security, citation, artifact, and language guidance is still appended. The precedence block is appended only when `agent.instructions` resolves to non-blank content.

## Persona and onboarding

`SOUL.md` is not a replica of Agent configuration. With a configured System Prompt, bootstrap may create or edit it only to record the Agent's name, personality, tone, and communication style; it must not discover, restate, or replace the configured role. Without a configured System Prompt, bootstrap preserves the legacy flow and may discover and store the role in `SOUL.md`. Bootstrap records user context in `USER.md` in both modes.

Saving Agent configuration never writes `SOUL.md`, and editing `SOUL.md` never writes `agent.instructions`. Existing custom files are preserved.

## Update and variable lifecycle

Saving `agent.instructions` invalidates the connection rebuild signature. Changes to `app.user.name` and the Agent's resolved primary model name also invalidate it because they affect `{{username}}` and `{{model_name}}`. An idle stale connection closes eagerly; a live response finishes with its captured prompt; the next fresh model turn rebuilds and sees the saved value.

System Prompt variables are resolved when the Agent's Claude Code connection is created or rebuilt. `{{model_name}}` uses the Agent's resolved primary model name. Volatile values such as `{{date}}`, `{{time}}`, and `{{datetime}}` remain connection snapshots until another rebuild; they do not force a rebuild every turn.

## Implementation map

- `src/main/ai/runtime/claudeCode/settingsBuilder.ts` owns final Agent prompt composition and variable materialization.
- `src/main/ai/agents/prompt.ts` owns workspace base selection and persona/memory context.
- `src/main/ai/agents/bootstrap.ts` owns first-run persona and user onboarding guidance.
- `src/main/ai/agentSession/AgentSessionRuntimeService.ts` owns next-turn connection reconciliation.
