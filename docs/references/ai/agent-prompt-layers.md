# Agent Prompt Layers

Agent conversations combine several independently stored prompt sources. They are not synchronized because each source has a different scope and lifecycle.

## Source contract

| Priority | Source | Storage | Scope and lifecycle |
|---:|---|---|---|
| 1 | Platform and runtime safety constraints | Application and runtime code | Non-overridable runtime policy; materialized with the connection |
| 2 | Agent System Prompt | `agent.instructions` in Agent configuration | Authoritative role, goals, capability scope, and behavioral constraints; applies from the next fresh model turn after save |
| 3 | Workspace Instructions | `<workspace>/system.md` | Workspace-local guidance; when present, it replaces the Claude Code preset base, including when the file is empty |
| 4 | Agent Persona | `<agent-data>/SOUL.md` | Persistent name, personality, tone, and communication style across workspaces |

Lower-priority guidance still applies when it does not conflict with a higher-priority source. `USER.md`, `memory/FACT.md`, journal entries, and retrieved knowledge are context rather than behavioral authority. This hierarchy is an explicit instruction contract provided to the model, not a deterministic enforcement or security boundary; application and runtime hooks independently enforce hard runtime and tool-safety constraints.

## System Prompt authoring

Assistant and Agent editors both call the field **System Prompt** and expose variable insertion, resolved preview, generation, and polishing. Their storage and runtimes remain different: Assistant stores `assistant.prompt`; Agent stores `agent.instructions`. The editor's resolved preview is display-only: unresolved source text is persisted, and Main resolves it independently when materializing a connection.

For Agents, the configured System Prompt is wrapped in `<agent_instructions>` when the Claude Code connection is built. Workspace and persona content remain present, but they cannot redefine the Agent role.

## Workspace Instructions

An explicit `system.md` keeps its existing base-selection behavior. Its presence replaces the Claude Code preset base; an empty file deliberately selects an empty custom base. Cherry-owned precedence, persona, memory, workspace-path, security, citation, artifact, and language guidance is still appended.

## Persona and onboarding

`SOUL.md` is not a replica of Agent configuration. Bootstrap may create or edit it to record the Agent's name, personality, tone, and communication style. Bootstrap also records user context in `USER.md`, but it must not discover, restate, or replace the role already defined by the Agent System Prompt.

Saving Agent configuration never writes `SOUL.md`, and editing `SOUL.md` never writes `agent.instructions`. Existing custom files are preserved.

## Update and variable lifecycle

Saving `agent.instructions` invalidates the connection rebuild signature. An idle stale connection closes eagerly; a live response finishes with its captured prompt; the next fresh model turn rebuilds and sees the saved value.

System Prompt variables are resolved when the Agent's Claude Code connection is created or rebuilt. `{{model_name}}` uses the Agent's resolved primary model name. Volatile values such as `{{time}}` and `{{datetime}}` remain connection snapshots until another rebuild; they do not force a rebuild every turn.

## Implementation map

- `src/main/ai/runtime/claudeCode/settingsBuilder.ts` owns final Agent prompt composition and variable materialization.
- `src/main/ai/agents/prompt.ts` owns workspace base selection and persona/memory context.
- `src/main/ai/agents/bootstrap.ts` owns first-run persona and user onboarding guidance.
- `src/main/ai/agentSession/AgentSessionRuntimeService.ts` owns next-turn connection reconciliation.
