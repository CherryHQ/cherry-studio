# Agent Note: Remote Agent controls and per-turn model overrides

Status: proposed

English | [中文](2026-11-05-remote-agent-controls.zh.md)

## Problem

When connecting to Desktop Cherry Studio from Mobile via Remote Access, users currently have limited control over ongoing and newly created agent sessions:
1. Tool approval requests forwarded from Desktop to Mobile only permit binary allow/deny decisions. If a user rejects a dangerous or inappropriate tool call (such as writing to a sensitive path or running a destructive command), they cannot provide a rejection explanation to guide the agent toward an alternative approach.
2. Agent sessions cannot be renamed from Mobile. Desktop remains authoritative, but lacks an RPC endpoint and event subscription to accept title changes initiated from remote clients.
3. Model and reasoning-effort selection on Mobile either mutated the shared Desktop `agent` entity or was completely disabled. Because multiple Desktop and Mobile sessions share a single Agent definition, mutating the global Agent record silently alters model and effort settings for all subsequent or concurrent sessions on Desktop.

## Proposal

Implement protocol, desktop service, and execution context support for session-level remote agent controls:

### 1. Capability negotiation and available models discovery
- `connection.hello` advertises `agentSessionRenameVersion: 1` and `agentModelSelectionVersion: 1`. Older or mismatched peers gracefully disable or hide these controls without crashing.
- `agent.agents.list` includes the Agent's configured `reasoningEffort` and filtered `availableModels: AgentModelOption[]` (enriched with supported `reasoningEfforts` derived via `deriveThinkingOptions` and filtered by `AGENT_RUNTIME_CAPABILITIES[agent.type].isModelCompatible`).

### 2. Session rename endpoint (`agent.sessions.update`)
- `@cherrystudio/remote-protocol` declares `AgentSessionUpdateMethod` (`agent.sessions.update`) accepting `{ commandId, sessionId, title }`.
- Desktop handles `agent.sessions.update` by validating session existence, invoking `AgentSessionService.update(sessionId, { name: title })` with `isNameManuallyEdited = true` (to prevent automated LLM titles from overwriting the user's manual title), recording command completion in `RemoteCommandService`, and broadcasting a `session.updated` event to active stream subscribers.
- Command deduplication is ensured through the canonical JCS digest in `encodeAgentCommand`.

### 3. Per-turn model and reasoning-effort overrides
- `agent.sessions.create` and `agent.messages.send` accept optional `model: { providerId, modelId }` and `reasoningEffort`.
- Desktop validates model compatibility against the agent runtime capabilities during dispatch (`AgentChatContextProvider.validateDispatch`).
- Overrides are applied strictly to the active turn execution context and recorded in the `agent_session_message` metadata snapshot. The shared `agentTable` database record is never mutated, preserving isolation across concurrent sessions.

### 4. Tool approval denial reason
- The remote protocol and desktop `agentHandlers.ts` already support an optional string `reason` (1–4096 characters) in `agent.interactions.respond` for `kind: 'deny'`, tagged with `reasonSource: 'user'`. Desktop feeds this reason back to the agent runtime so the model receives actionable corrective context.

## Alternatives considered

- Mutating `agentTable` via `AgentService.updateAgent` on model selection: Rejected. Agents are shared across sessions. Changing the agent configuration from one mobile turn would side-effect all other sessions and desktop workflows sharing that agent.
- Independent mobile session database for titles: Rejected. Desktop is the authoritative store for sessions and history. Keeping titles in desktop's database ensures consistency across devices and reloads.
- Client-side title updates without optimistic locking: Rejected. Using `RemoteCommandService` journal guarantees idempotent retries across intermittent mobile network drops.

## Acceptance criteria

- AC1 — `connection.hello` advertises `agentSessionRenameVersion: 1` and `agentModelSelectionVersion: 1` capability flags. (verification: unit — remote-protocol test maintainers, `contracts.test.ts`)
- AC2 — `agent.sessions.update` validates session existence and input, updates the session title with `isNameManuallyEdited: true`, deduplicates commands via `RemoteCommandService`, and broadcasts `session.updated` events. (verification: unit — remote-access test maintainers, `agent.test.ts`)
- AC3 — `agent.agents.list` queries and exposes the agent's default `reasoningEffort` and runtime-compatible `availableModels` with thinking options. (verification: unit — remote-access test maintainers, `agent.test.ts`)
- AC4 — `agent.sessions.create` and `agent.messages.send` accept optional per-turn `model` and `reasoningEffort` overrides, validating model compatibility at dispatch time. (verification: unit — remote-access and stream-manager test maintainers, `agent.test.ts`)
- AC5 — Turn model and reasoning-effort overrides record in the turn snapshot and message metadata without mutating the shared `agentTable` record. (verification: unit — stream-manager test maintainers, `agent.test.ts`)

## Risks

- Incompatible model override: A client could submit a model ID that lacks required tool-calling capabilities. Mitigation: Desktop validates compatibility against `AGENT_RUNTIME_CAPABILITIES[agent.type]` before accepting the run, rejecting incompatible dispatches cleanly.
- Network interruption during rename: A dropped connection could leave the client uncertain of rename completion. Mitigation: `RemoteCommandService` deduplicates by `commandId` and returns the recorded receipt upon reconnection.
