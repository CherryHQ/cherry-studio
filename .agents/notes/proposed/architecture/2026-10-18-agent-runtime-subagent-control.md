# Agent Note: Subagent ownership and optional runtime controls

Status: proposed

English | [中文](2026-10-18-agent-runtime-subagent-control.zh.md)

## Problem

Cherry needs to observe subagents, manage delegated work, and continue a conversation with a child where its harness allows it. Some harnesses expose only a task result, while others expose an independently accessible conversation. Discovery, observation, input, and cancellation are separate capabilities.

The [current runtime contract](2026-10-17-agent-runtime-contract.md) requires `Delegation.child` and `ThreadHandle.submit`. Those requirements cannot directly express an observable delegation without a public child conversation, or a child that can be observed but cannot receive input through that access. This note records the Pi integration choice and proposed extensions to that contract; it does not change the implemented v0 API or claim desktop integration.

[AgentSessionDeliveryService](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/src/main/ai/agentSession/AgentSessionDeliveryService.ts) delivers messages between Cherry product sessions. Creating a session and delivering a first message does not establish subagent ownership, cancellation propagation, or resource cleanup. It is not the subagent controller.

Implementation facts in this note refer to the cumulative runtime stack inspected at `bd6509eb5f71a9c6bbb57453f0a7ced25e92c766`. Behavior supplied by later layers remains a target at this layer; the note does not claim those features are already present here. Source links use that fixed snapshot, and notes not yet introduced link to their owning PR.

## Proposal

### Keep the Pi subagent extension we own

Retain the existing subagent implementation in `packages/agent-runtime-pi`. The current choice is to avoid taking on community-plugin TUI integration and terminal interaction assumptions while Cherry provides its own UI. This is an integration decision, not a claim that every community plugin requires a TUI or cannot run headlessly. Community implementations remain useful references; changing this choice would require evaluating a concrete reusable execution interface separately from its presentation layer.

The [Pi subagent extension](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi/src/subagent.ts) owns child creation, continuation, run tracking, and result delivery. It continues to use native Pi sessions, tools, execution loops, and storage. Cherry owns presentation, permissions, and product configuration; the extension and common runtime package must not depend on terminal widgets or Cherry renderer code. The [background subagent note](https://github.com/CherryHQ/cherry-studio/pull/21693) owns Pi-specific behavior.

### Separate a delegation from its conversation

- `Delegation` identifies one assignment and its parent. It may link to an independently accessible child `Thread`; making `child` optional is a proposed change. A delegation without a child still needs native identity and relationship evidence. Tool-result prose alone is not enough to invent one.
- `Thread` identifies a reusable native context. Multiple delegations can use it. Completing one assignment does not close the context, and later input does not change that assignment's historical outcome.
- An input-capable access could expose `ThreadHandle.input`, grouping `submit` with supported busy policies. An observation-only access would omit it. This is a proposed shape, not an additional capability matrix or an implemented signature.
- Capability belongs to the concrete access, not just the harness name. An available input operation can still reject because of current state or permissions. Unsupported input must not silently become a message to the parent or a new conversation.

### Keep control targets explicit

| Operation | Target | Intended contract |
| --- | --- | --- |
| `spawn` | A new delegation from a parent | Establish managed child work and return its delegation identity and any accessible child context. |
| `submit` | A conversation | Admit an input under a supported busy policy; admission does not prove completion. |
| `cancel` | One delegation | Request cancellation of that assignment's owned work, without cancelling a later assignment that reused its child. |
| `interrupt` | A conversation | Request interruption within the documented native scope; it is not a promise to cancel every background descendant. |
| `release` | A local access | Release subscriptions and access resources without cancelling the work. |

Creation and delegation cancellation are optional control extensions. Observing a child does not grant these controls. An adapter exposes an operation only when it can preserve the target and scope; a cancellation request receipt is not a terminal cancellation outcome. Pi's current child-level stop must not be relabeled as exact delegation cancellation without preserving the intended run identity.

For native subagents, controls go through the native owner: our Pi extension or Pi Durable's task/conversation APIs. The common package does not maintain a competing queue, scheduler, or native lifecycle registry.

### Compose runtimes when the host owns the delegation

For a host-created child, the orchestration layer creates a normal context through the selected runtime and owns its delegation relationship, control policy, and result handoff. The target harness owns execution. This can compose the same harness or different harnesses, provided the parent can invoke the delegation entry and the target exposes the required creation and input capabilities. Each child is routed through its own backend, rather than opened through the parent's runtime by assumption.

An existing harness-owned child is not silently converted to a host-owned child. A cross-harness child receives explicit instructions and materials; native context forking and in-flight recovery are not assumed portable. A child does not need a Cherry product-session row merely to exist as a subagent.

Observing child output and reporting an assignment's result to the parent are separate paths. Native delegation results keep their native delivery owner; observing completion must not inject another result. The host handles delivery only for delegations it owns. Later user conversation with the child does not automatically become another result for the original parent assignment.

### Preserve the current implementation facts

| Implementation | Verified source behavior | Remaining boundary |
| --- | --- | --- |
| Pi adapter | Our extension provides `message_subagent`, while [the common access](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi/src/runtime.ts) rejects managed-child submission. | Bridge input through the extension's controller; do not bypass it by prompting its child session directly. |
| Pi Durable adapter | [Child access](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi-durable/src/runtime.ts) already exposes native conversation input, observation, and interruption. | Preserve native task ownership, background cancellation boundaries, and Harness-wide scheduler activation by submit/interrupt. |
| Adapter coverage | The [Pi Durable child test](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi-durable/tests/runtime.test.ts) covers discovery and independent observation. | It does not establish a complete continued-child-conversation flow, unified spawn/cancel, or desktop acceptance. |

Pi Durable's owned child is a native conversation. Its tool-call-bound `api.conversation()` handle expires with the invocation; host access uses `harness.conversation(id)`. The foreground and background subagent examples in Pi Durable 1.3.0 demonstrate different ownership boundaries; continued input alone does not arrange result reporting to the parent. These native differences remain relevant even when the public operation names match.

### Decisions still to make

The optional input shape and delegation control entry are candidates, not frozen signatures. Before implementation, settle the spawn configuration boundary, identities and receipts when creation only partially succeeds, exact cancellation targets, parent interruption/shutdown behavior for foreground and background children, result-reporting policy, and restoration of host-owned relationships. Preserve adapter-specific typed configuration until a shared consumer proves a common contract is needed.

## Alternatives considered

- Replace our Pi subagent extension with a community plugin now: not selected for this integration because terminal presentation and control boundaries require separate evaluation. This does not reject community reuse in general.
- Require every child to support conversation, or emulate missing input by messaging the parent or starting another child: rejected because it changes the target and invents capabilities.
- Extend `AgentSessionDeliveryService` into the subagent owner: rejected because message delivery does not define delegation ownership or cancellation.
- Use a global string capability matrix or mirror native scheduling in the common package: rejected because it duplicates interpretation and execution ownership. Concrete operations and their receipts should express the supported behavior.

## Acceptance criteria

These are proposed implementation outcomes, not tests completed by this documentation change.

- AC1 — The Pi subagent extension supports its controls through a host with no TUI or Cherry renderer dependency, while the public input path uses the same child owner. (verification: unit — Pi adapter integration tests)
- AC2 — An observable delegation without an accessible child, or a child without input support, remains representable without inventing a thread or silently routing input elsewhere. (verification: unit — common contract and adapter tests)
- AC3 — Completing a delegation or releasing a parent observation does not close a retained child context; later assignments retain the child identity and get distinct delegation identities. (verification: unit — adapter lifecycle tests)
- AC4 — Delegation cancellation does not affect a later assignment on the same child, and conversation interruption preserves the documented background scope; request receipts are distinct from terminal outcomes. (verification: unit — adapter cancellation tests)
- AC5 — Observing child completion does not duplicate native result delivery, and later child conversation does not implicitly report another result for an earlier assignment. (verification: unit — Pi extension and host orchestration tests)
- AC6 — A host-created child can use another configured runtime, receive further input when supported, and be controlled by its delegation owner without depending on product-session delivery. (verification: unit — host orchestration integration tests)

## Risks

Keeping our Pi extension carries maintenance cost. Capability exposure can drift from the native controller unless adapters verify the same behavior their public operations promise. Durable submission can activate other conversations through the shared scheduler, and reopening context is not equivalent to recovering unfinished execution. Unresolved cancellation races, partial creation, and result attribution must be specified before treating this proposal as an implementation contract.
