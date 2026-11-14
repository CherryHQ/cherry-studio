# Agent Note: Session-owned model selection

Status: implemented

English | [中文](2026-11-14-agent-session-model-ownership.zh.md)

## Problem

The conversation model picker changed the shared Agent model. Selecting a model in one conversation therefore changed sibling sessions and the default used by scheduled work. Moving only the picker write would leave prompt variables, tools, runtime validation and connection construction reading different model owners, especially after an edit during an active turn.

## Decision

An interactive conversation persists its selection in `agent_session.model`. Its effective model is `session.model ?? agent.model`; an unselected session follows the Agent default. Scheduled and other headless turns use the Agent default. The Agent remains the owner of its default and other cognitive configuration.

Turn preparation captures the effective model. Runtime connection construction, prompt variables and model-dependent tools use that captured selection so a later edit cannot redirect an admitted turn. Durable recovery preserves a historical saved request's model before considering current session or Agent defaults. Current runtime behavior is documented in [Agent Session Runtime](../../../../docs/dev/references/ai/agent-session-runtime.md) and [Agent Prompt Layers](../../../../docs/dev/references/ai/agent-prompt-layers.md).

## Alternatives considered

- Keep Agent-level selection and warn before switching: confirmation does not remove the shared-state mutation or protect sibling conversations and scheduled work.
- Store the selection only in a renderer cache: the choice would not have a durable session owner across windows, restarts, forks and runtime recovery.
- Re-resolve the current selection in every consumer: a mid-turn edit could mix the captured request with another model's prompt or tools.

## Consequences

The additive nullable foreign key leaves existing sessions following their Agent default. Deleting a selected model clears the override through `ON DELETE SET NULL`; deletion notifications refresh affected mounted sessions. Forks inherit the override and reject a source-model change before committing. Agent reassignment preserves the bound session runtime and its model override, including Claude subscription models. For Pi and Pi Durable sessions, an incompatible inherited override is cleared atomically with reassignment. Runtime ownership follows [session runtime binding](../../proposed/architecture/2026-11-12-session-runtime-binding.md), rather than the replacement Agent type.

This separates the interactive model choice from the Agent default without turning other Agent settings into session settings. A captured turn and a historical saved request can intentionally retain an older model selection after the session is edited.

## Verification

- Regression — The focused Main run included `src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.test.ts` and `src/main/ai/runtime/claudeCode/__tests__/buildMcpServers.test.ts`: Durable prompts and `create_agent` use the captured model, peer recovery preserves saved request selections, and MCP routing uses the effective connection model.
- Regression — The focused renderer run included `src/renderer/windows/selection/agent/components/__tests__/SelectionAgentConversation.test.tsx`, `src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx` and `src/renderer/pages/agents/__tests__/useAgentConversationBootstrap.test.ts`: selection-window conversations and the composer use the session model, and bootstrap resolves the session override before the Agent default.
- Regression — `pnpm typecheck:node` and `pnpm typecheck:web` passed.

These results cover local checks for this repair. Electron interaction, real-provider execution and CI on the new head have not been verified; green CI on the earlier head does not validate the later changes.
