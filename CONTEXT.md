# Cherry Studio Domain Context

This glossary defines the product language used when configuring and running Cherry Studio Agents. It keeps user-facing concepts distinct when they influence the same Agent behavior.

## Agent Identity

**System Prompt**:
The shared user-facing configuration for defining an Assistant's or Agent's role, goals, capability scope, and behavioral constraints. For an Agent, the System Prompt expresses its Agent Instructions and has higher authority than Workspace Instructions and Agent Persona.
_Avoid_: Agent Persona, complete assembled runtime prompt

**Agent Instructions**:
The authoritative definition of an Agent's role, goals, capability scope, and behavioral constraints. Agent Instructions take precedence over Workspace Instructions and the Agent Persona when they conflict.
_Avoid_: Agent Persona, role prompt

**Agent Persona**:
An Agent's personality, tone, and communication style. It shapes expression without changing or overriding the Agent Instructions.
_Avoid_: Agent Instructions, role definition

**Workspace Instructions**:
The operating rules and project context that apply only within the current workspace. They cannot redefine the Agent and yield to Agent Instructions when they conflict.
_Avoid_: Agent Instructions, system prompt

**Agent Onboarding**:
The process that learns and refines an Agent's persona and relationship with the user. It preserves the existing Agent Instructions and does not define or modify the Agent's role, goals, capability scope, or behavioral constraints.
_Avoid_: Role configuration, instruction editing

**Instruction Precedence**:
The order for resolving conflicting behavioral directions: platform and runtime safety constraints, Agent Instructions, Workspace Instructions, then Agent Persona. User profiles and memories provide context rather than behavioral authority; a lower layer applies only when it does not conflict with a higher layer.
_Avoid_: Prompt order, last instruction wins

**System Prompt Capability Parity**:
The shared System Prompt authoring and execution contract for Assistants and Agents: variable insertion and preview, prompt generation and polishing, variable resolution when each runtime materializes its prompt, and application to the next eligible model turn. It does not imply identical prompt-refresh lifecycles or parity between their model parameters, tools, permissions, skills, workspaces, or execution runtimes.
_Avoid_: Full Assistant-Agent feature parity, runtime unification

**System Prompt Update Boundary**:
A saved System Prompt applies from the next model turn. A response already being generated keeps the prompt snapshot it started with and is not interrupted or restarted.
_Avoid_: Live prompt mutation, current-response restart

**Agent System Prompt Snapshot**:
The resolved System Prompt captured when an Agent's Claude Code connection is created or rebuilt. Stable and volatile variables share that connection lifetime; unlike an Assistant request, an Agent turn does not force variable re-resolution solely because time has advanced.
_Avoid_: Per-turn Agent prompt, live variable refresh
