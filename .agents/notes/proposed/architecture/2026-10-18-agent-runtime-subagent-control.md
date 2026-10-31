# Agent Note: Subagent ownership and optional runtime controls

Status: proposed

English | [中文](2026-10-18-agent-runtime-subagent-control.zh.md)

## Problem

Cherry needs to observe subagents, manage delegated work, and continue a conversation with a child where its harness allows it. Some harnesses expose only a task result, while others expose an independently accessible conversation. Discovery, observation, input, and cancellation are separate capabilities.

The earlier runtime contract required `Delegation.child` and `ThreadHandle.submit`. Those requirements could not directly express a relationship without a public child conversation, or an observation-only child access. The [current contract](2026-10-17-agent-runtime-contract.md) implements optional child context and input access, with owner-routed Pi child input. This note records that implemented slice and the remaining control proposals; it does not claim desktop integration.

The [cross-harness follow-up](../testing/2026-10-17-agent-harness-evidence.md#subagent-comparison-and-design-consequences) found that the former `Delegation` observations did not consistently identify one assignment. Pi combined a triggering tool call with the child; Durable combined a conversation's owner task with the child. In the Durable background example that owner is a retained anchor, not each message's reporter. Both adapters now expose stable child relationships without presenting them as assignment identities.

[AgentSessionDeliveryService](../../../../src/main/ai/agentSession/AgentSessionDeliveryService.ts) delivers messages between Cherry product sessions. Creating a session and delivering a first message does not establish subagent ownership, cancellation propagation, or resource cleanup. It is not the subagent controller.

## Proposal

### Keep common spawn/stop as follow-up work

The current integration work focuses on the three runtime packages' access, input, independent observation, and resource boundaries. Child discovery, observation, and optional input belong to that work. Common spawn/stop is a separate follow-up control extension and does not block adopting those existing contracts. Record its direction here while keeping the extension proposed and unimplemented; cross-harness orchestration also remains follow-up work.

The [desktop implementation plan](2026-10-17-agent-runtime-contract.md#desktop-integration-implementation-plan) owns the P0–P4 sequence, input-correlation gate, context/input persistence, independent child projection, and cold-recovery acceptance. This note continues to own the later control contract. The [community orchestration sample](../testing/2026-10-17-agent-harness-evidence.md#community-orchestration-sample-pi-durable-subagents) informs the boundaries without replacing Cherry's Pi owner or adding another scheduler to the common package.

### Keep the Pi subagent extension we own

Retain the existing subagent implementation in `packages/agent-runtime-pi`. The current choice is to avoid taking on community-plugin TUI integration and terminal interaction assumptions while Cherry provides its own UI. This is an integration decision, not a claim that every community plugin requires a TUI or cannot run headlessly. Community implementations remain useful references; changing this choice would require evaluating a concrete reusable execution interface separately from its presentation layer.

The [Pi subagent extension](../../../../packages/agent-runtime-pi/src/subagent.ts) owns child creation, continuation, run tracking, and result delivery. It continues to use native Pi sessions, tools, execution loops, and storage. Cherry owns presentation, permissions, and product configuration; the extension and common runtime package must not depend on terminal widgets or Cherry renderer code. The [background subagent note](../feature/2026-10-14-agent-runtime-background-subagent.md) owns Pi-specific behavior.

### Separate the child relationship, context, and assigned work

The earlier proposal treated every `Delegation` observation as one assignment. Replace that assumption with three distinct meanings; this does not require three new public entities.

| Meaning | Minimum public guarantee | Limit |
| --- | --- | --- |
| Observed subagent relationship | Evidence of a parent and related child work, with an accessible child `Thread` when available. | It may outlive several inputs and runs. A correlation ID for display is not a durable assignment receipt. |
| Child context | `Thread` identifies a reusable native context under its backend. | One-shot work can lack a public context. An accessible context need not accept input or support reopening after restart. |
| One assignment or activation | Keep a boundary and outcome only when the owner supplies evidence for them. A host-owned assignment can have an identity allocated by its orchestrator. | A native owner task, input, tool call, and model turn are not interchangeable assignment identities. |

The implemented `Subagent { id, parent, child? }` replaces `Delegation`. Snapshots expose `subagents`, and `subagent.upsert` replaces `delegation.upsert`. Relationship IDs are scoped to the parent and stable across child inputs and runs; the two adapters use their native child context IDs. Delegation remains the term for work assigned and tracked by an identified owner. No mandatory `Task` or `Run` fills that role. A relationship requires native evidence, not inferred tool-result prose; an idle child can later work again, and completing an assignment does not end the relationship or change earlier outcomes.

- An input-capable access exposes `ThreadHandle.input`, grouping `submit` with supported `policies`. An observation-only access omits it. Both concrete Pi and Durable handles provide this group; the common contract does not require every adapter to do so.
- Capability belongs to the concrete access, not just the harness name. An available input operation can still reject because of current state or permissions. Unsupported input must not silently become a message to the parent or a new conversation.

`whenBusy` only describes admission while a target is busy. It cannot also mean whether a message wakes an idle child: Codex's internal collaboration tools distinguish queue-only messaging from input that triggers a turn. Keep such messaging adapter-specific until a host consumer needs a shared operation. Reconnection must renew control authority; historical relationship records do not grant input or cancellation permission.

### Keep control targets explicit

| Operation | Target | Intended contract |
| --- | --- | --- |
| `spawn` | Child work created through an owner | An optional owner control establishes the relationship and reports creation/admission evidence. Native model tools do not automatically expose this operation to the host. |
| `stop` | A child's current work, addressed through its owner | Request stopping the child within an explicit scope. This is neither exact cancellation of a past assignment nor deletion of the child's context. |
| `submit` | A conversation | Admit an input under a supported busy policy; admission does not prove completion. |
| `cancel` | One identified assignment or activation | Expose only when the owner can target that exact work without cancelling a later assignment that reused its child. A persistent cancellation ID is not assumed. |
| `interrupt` | A conversation | Request interruption within the documented native scope; it is not a promise to cancel every background descendant. |
| `release` | A local access | Release subscriptions and access resources without cancelling the work. |

The proposed entry is an optional control group on the parent access, illustrated by `parent.subagents.spawn(...)` and `parent.subagents.stop(id)`. These are design sketches, not current signatures; each operation is available only when the owner can support it. `snapshot.subagents` remains relationship data, not control authority. Targeting the relationship through its owner can also support a child with no independently openable thread. Existing child input remains `child.input.submit(...)`, and `child.release()` only releases access.

Creation, stopping, and exact assignment cancellation are separate optional controls. Ordinary stop does not depend on finishing the exact-cancellation design: if a child runs A and later B, `stop(child)` targets its current work, while `cancel(A)` must not affect B. Observing a child does not grant either control. An adapter exposes an operation only when it can preserve the target and scope; a stop/cancellation request receipt is not a terminal outcome. Pi's current child-level stop must not be relabeled as exact delegation cancellation without preserving the intended run identity.

Before implementing common stop, resolve the concrete differences. Pi's current managed-foreground `interrupt` may abort the parent turn; stopping a background child as the user prohibits continuation of that stopped run. A child-only stop contract cannot simply rename this behavior. Durable conversation abort, background ownership boundaries, and reporter tasks have distinct effects; spawning requires native ownership and initial admission, not merely an unrelated `create` followed by `submit`. The supported stop scope and whether later child input is allowed need explicit decisions and adapter evidence.

DSH demonstrates an exact activation control through a live closure; ACP's experimental child control targets current session work instead. Both can be useful without pretending to provide the same cancellation identity or restart guarantee. Native close/shutdown can also reach descendants; neither is a substitute for releasing an observation handle. No mandatory common spawn/cancel interface is justified by this research.

For native subagents, controls go through the native owner: our Pi extension or Pi Durable's task/conversation APIs. The common package does not maintain a competing queue, scheduler, or native lifecycle registry.

### Compose runtimes when the host owns the delegation

For a host-created child, the orchestration layer creates a normal context through the selected runtime and owns its delegation relationship, control policy, and result handoff. The target harness owns execution. This can compose the same harness or different harnesses, provided the parent can invoke the delegation entry and the target exposes the required creation and input capabilities. Each child is routed through its own backend, rather than opened through the parent's runtime by assumption.

An existing harness-owned child is not silently converted to a host-owned child. A cross-harness child receives explicit instructions and materials; native context forking and in-flight recovery are not assumed portable. A child does not need a Cherry product-session row merely to exist as a subagent.

Observing child output and reporting an assignment's result to the parent are separate paths. Native delegation results keep their native delivery owner; observing completion must not inject another result. The host handles delivery only for delegations it owns. Later user conversation with the child does not automatically become another result for the original parent assignment.

### Preserve the current implementation facts

| Implementation | Verified source behavior | Remaining boundary |
| --- | --- | --- |
| Pi adapter | [Common child input](../../../../packages/agent-runtime-pi/src/runtime.ts) and the model's `message_subagent` share the owner's `messageSubagent` admission path. | Only `steer` is exposed. Finished children require `SubagentPort.load`; user-stop refusal and continuation locks remain with the owner. |
| Pi Durable adapter | [Child access](../../../../packages/agent-runtime-pi-durable/src/runtime.ts) already exposes native conversation input, observation, and interruption. | Preserve native task ownership, background cancellation boundaries, and Harness-wide scheduler activation by submit/interrupt. |
| Adapter coverage | The [Pi](../../../../packages/agent-runtime-pi/tests/runtime.test.ts) and [Durable](../../../../packages/agent-runtime-pi-durable/tests/runtime.test.ts) tests exercise child discovery, continued input, steering, independent observation after release, and stable relationship identity through native execution. | Unified spawn/cancel, cross-harness orchestration, crash recovery, and desktop acceptance remain outside this slice. |

Pi Durable's owned child is a native conversation. Its tool-call-bound `api.conversation()` handle expires with the invocation; host access uses `harness.conversation(id)`. The foreground and background subagent examples in Pi Durable 1.3.0 demonstrate different ownership boundaries; continued input alone does not arrange result reporting to the parent. These native differences remain relevant even when the public operation names match.

Pi continuation starts a new background run whose owner reports its result once under existing extension policy. Host input does not fabricate a triggering tool-call ID. Durable direct conversation input creates no reporter and leaves parent output unchanged in the adapter test. Observation never creates either report; later work does not rewrite the original assignment's outcome.

### Verify the implemented slice

The [common observation test](../../../../packages/agent-runtime/tests/observation.test.ts) represents a relationship without child access and later supplies the child without changing relationship identity. Pi integration exercises native stored-child continuation and live steering through public input, preserves observation through child rebinding, verifies one native parent notification, and joins an in-flight child load before shutdown disposes the owner. Durable integration exercises completed-child reuse, busy rejection, steering and input completion, while another child handle keeps observing after the parent and first child accesses are released.

These tests cover the input bridge and relationship slice of AC1–AC3 and AC5, with existing owner interruption and passive-observation coverage contributing to AC4 and AC7. They do not establish exact assignment cancellation, cross-harness orchestration (AC6), or all stop/recovery/reporting combinations. Native loops use deterministic offline providers; no live provider or Electron acceptance is claimed.

### Share Pi product rules only where the execution semantics agree

Pi and Pi Durable can implement the same Cherry subagent behavior without sharing their execution machinery. Keep three boundaries:

| Boundary | Responsibility |
| --- | --- |
| Common runtime | Relationship and output observation, optional input, and controls whose target and effect are proven. It does not own children. |
| Harness adapter and its extension | Native child creation, input admission, cancellation, result settlement, storage, and recovery. Pi uses sessions and its extension controller; Durable uses conversations, tasks, and commits. |
| Cherry host | Product permissions, model selection, presentation, and any delegation it creates across harnesses. Native child execution stays with its harness. |

Extract pure request validation or result-formatting rules only after both implementations need the same behavior. Do not first move Pi's registry, run counter, inbox, or delivery pump into `agent-runtime`. Durable's anchor, reporter, submission deduplication, and answer-entry deduplication must continue to use its native commits and replay model. Several submissions can share one answer; neither input acceptance nor observing that answer authorizes an extra parent report.

There is already a product-policy difference to resolve when implementing Durable support: [Cherry Pi delivery](../../../../packages/agent-runtime-pi/src/subagentDelivery.ts) suppresses automatic wake after a user stops the parent until another run starts; the upstream Durable example allows a report arriving after the stop to start a parent turn. Preserve Cherry's existing stop policy when adapting that behavior, with native durable state as needed, rather than inheriting the example's timing. Source comparison does not establish that this parity has been implemented.

### Decisions still to make

Relationship observation and optional input access are implemented. When the follow-up control work starts, first expose Pi spawn/stop through owner methods shared by its model tools and host calls; then implement the corresponding behavior through Durable's native tasks/conversations and compare the promises before finalizing common signatures. The common package defines contracts, the adapters execute native controls, and the host owns cross-harness orchestration.

Remaining decisions include spawn configuration, partial-creation receipts, stop scope and subsequent input, exact cancellation targets, parent shutdown policy for host-owned work, and host-owned relationship restoration. Preserve adapter-specific typed configuration until a shared consumer proves a common contract is needed. The evidence note distinguishes completed package checks from remaining acceptance scenarios, including Durable product-reporting parity and recovery.

## Alternatives considered

- Replace our Pi subagent extension with a community plugin now: not selected for this integration because terminal presentation and control boundaries require separate evaluation. This does not reject community reuse in general.
- Require every child to support conversation, or emulate missing input by messaging the parent or starting another child: rejected because it changes the target and invents capabilities.
- Extend `AgentSessionDeliveryService` into the subagent owner: rejected because message delivery does not define delegation ownership or cancellation.
- Use a global string capability matrix or mirror native scheduling in the common package: rejected because it duplicates interpretation and execution ownership. Concrete operations and their receipts should express the supported behavior.

## Acceptance criteria

These are acceptance targets for the full proposal. The implemented subset and its test limits are described above; this note remains proposed while the remaining controls and host integration are unresolved.

- AC1 — The Pi subagent extension supports its controls through a host with no TUI or Cherry renderer dependency, while the public input path uses the same child owner. (verification: unit — Pi adapter integration tests)
- AC2 — An observable delegation without an accessible child, or a child without input support, remains representable without inventing a thread or silently routing input elsewhere. (verification: unit — common contract and adapter tests)
- AC3 — Reusing a child preserves its relationship and context identity without inventing a new assignment for every message; separately identified assignments keep their own outcomes. Releasing a parent observation does not close retained children. (verification: unit — adapter lifecycle tests)
- AC4 — Any advertised exact cancellation cannot affect later work on the same child; session-scoped interruption is identified as such and preserves its documented background scope. Unsupported exact controls remain absent, and receipts remain distinct from terminal outcomes. (verification: unit — adapter cancellation tests)
- AC5 — Observing child completion does not duplicate native result delivery, and later child conversation does not implicitly report another result for an earlier assignment. (verification: unit — Pi extension and host orchestration tests)
- AC6 — A host-created child can use another configured runtime, receive further input when supported, and be controlled by its delegation owner without depending on product-session delivery. (verification: unit — host orchestration integration tests)
- AC7 — Passive child observation and restored history neither wake execution nor grant unsupported controls. Adapter tests distinguish input-triggered work, non-waking messaging where exposed, and parent result reporting after a stop or recovery. (verification: unit — adapter access and delivery tests)
- AC8 — If spawn creates a child but initial input fails or has an unknown outcome, its result preserves the known child identity and separates creation from admission; retry does not blindly create another child. (verification: unit — owner-routed spawn integration tests)
- AC9 — A supported child stop preserves the declared scope without stopping the parent or siblings when child-only control is promised; tests establish whether subsequent input is accepted or rejected and distinguish the stop receipt from actual termination. (verification: unit — Pi and Durable owner control integration tests)

## Risks

Keeping our Pi extension carries maintenance cost. Capability exposure can drift from the native controller unless adapters verify the same behavior their public operations promise. Durable submission can activate other conversations through the shared scheduler, and reopening context is not equivalent to recovering unfinished execution. Unresolved cancellation races, partial creation, and result attribution must be specified before treating this proposal as an implementation contract.
