# Agent Note: Harness ownership and runtime package boundaries

Status: proposed

English | [中文](2026-10-17-agent-harness-boundaries.zh.md)

## Problem

Cherry needs a common way to access different agent harnesses without taking over their execution. Treating the product session, native context, current run, and rendered stream as one object makes background output depend on a parent message and creates competing owners for input queues, history, cancellation, and result delivery.

This note replaces the harness-definition document from the runtime stack. The three packages already exist, but desktop adoption, product-session storage relationships, and Lane projection remain integration work. It stays proposed because package implementation alone does not complete that integration or its acceptance criteria.

Implementation facts in this note refer to the cumulative runtime stack inspected at `bd6509eb5f71a9c6bbb57453f0a7ced25e92c766`. Behavior supplied by later layers remains a target at this layer; the note does not claim those features are already present here. Source links use that fixed snapshot, and notes not yet introduced link to their owning PR.

The [SDK content protocol proposal](../simplification/2026-10-29-agent-runtime-content-protocol.md) revises the content dependency boundary: a standard AI SDK message protocol dependency is permitted without importing native SDKs or Cherry product types into the common package. This supersedes the earlier blanket AI SDK exclusion; execution and native storage ownership stay with the harness.


## Proposal

### Define the harness by its behavior

An agent harness organizes agent execution: it admits input, manages context, coordinates models, tools and external interaction, advances work, and exposes observable facts and supported controls. It may be an embedded library, service, or the execution system behind a CLI. Process shape, transport, and persistence are not prerequisites.

| Behavior | Ownership | Facts that must remain distinct |
| --- | --- | --- |
| Admit and arrange input | Apply native rules to user input, steering, tool results, and notifications. | Acceptance, queueing, context placement, model consumption, and completion. |
| Manage context | Assemble instructions, history, tools, and compacted material for the model. | Displayed history and actual model context. |
| Advance execution | Coordinate model calls, tool feedback, waiting, and subsequent calls. | Tool failure, execution ending, and the user's goal being achieved. |
| Own related work | Define parent/child work, waiting, cancellation propagation, and result delivery where supported. | A reusable child context, an assignment, and a run. |
| Accept controls | Validate a target and report the native effect. | A request being received and its effect finishing. |
| Expose and recover facts | Offer native observation, lookup, and recovery paths where available. | Reconnecting, reopening context, and resuming execution. |

Subagents, background work, approval, durable recovery, and exact run controls are optional native abilities. An adapter must not invent them from output text or silently route an unsupported operation to a different target.

### Give each fact one owner

| Concept | Meaning and owner |
| --- | --- |
| Agent configuration | Role, instructions, model, tools, and policies; not an execution instance. |
| Harness | Owner of native context and the arrangement and execution of admitted work. |
| `AgentRuntime` | Public access to one configured harness, implemented by an adapter. There is no second synonymous `Backend` interface; `backendId` still identifies its namespace. |
| Adapter | Resolves native identities, maps observable facts, and manages access resources. It does not run a competing scheduler. |
| Host | Owns Cherry entry points, authorization, delivery records, resource policy, projection, and presentation. |
| Product session | Cherry's title, archive, and navigation object, explicitly related to native contexts without a mandatory one-to-one mapping. |
| `Thread` | A native context identity within a backend. Whether it is saved or can be reopened depends on the harness and storage configuration. |
| `ThreadHandle` / `Observation` | A local access and subscription, not ownership of the native context's business lifetime. |
| Input / Item | A logical input and independently updateable content. Their relationship need not be one-to-one. |
| Execution / Interaction | Evidence-backed work boundaries and external requests. The current common API does not expose these as public objects. |

Supplying a model implementation, tool, storage facility, or approval UI does not transfer execution ownership to the host. Each retry policy, queue, and result-delivery path needs one decision maker. The host owns desired configuration; the execution side confirms what it actually adopts and when it takes effect. A tool result, submission receipt, or UI state proves only its own scope.

The common package does not install CLIs, manage logins or business tables, or promise lossless migration across harnesses. Typed adapter configuration owns model, tool, storage, and extension integration until a real shared consumer establishes equivalent semantics.

### Keep child observation separate from Lane projection

Child streaming is harness observability. A Lane is a proposed host projection that organizes content, history relationships, and subscriptions by source; it is neither an execution scheduler nor a synonym for a panel or connection.

```text
Native harness facts -> adapter normalization -> host Lane/history projection -> UI
```

A child context, assignment, native run when known, triggering tool, content item, and display location have separate identities. A parent tool card may link to a child Lane, but it is not the child's permanent identity. Moving foreground work to the background preserves the child source; ending the parent message must not end observation of a still-running child.

Stream accumulation follows content identity, not component mounting or parent-turn changes. Persisted display parts do not preserve a stream parser's state. Reconnection needs snapshot reconciliation and explicit gaps. Renaming the existing background flow to Lane would not remove its parent-message dependency. A host projection can outlive a window and be stored by a main-process or independent service; that service is not implemented by the new common package.

Observing output and delivering a result to the parent model are different paths. Where the harness delivers the result, the host must not inject a duplicate on observing completion. For a host-owned cross-harness delegation, an explicit orchestration owner manages the relationship and result handoff while each harness owns its execution. Product-session message delivery alone does not establish this ownership. The [subagent control proposal](https://github.com/CherryHQ/cherry-studio/pull/21578) owns the remaining optional input and delegation controls.

### Separate native storage from product storage

| Content | Semantic owner and storage responsibility |
| --- | --- |
| Native context, queue, and checkpoint | The harness defines content and commit boundaries; the host may supply the storage facility. |
| Public/native identity mapping | The adapter interprets it. Any mapping required across restarts needs designated storage, not only memory. |
| Product sessions, logical inputs, transport attempts, and receipts | The host records handoff evidence and preserves uncertainty instead of marking unknown outcomes unexecuted. |
| Readable history, Lane, and multi-window projection | The host maintains them. Observation archives are not disposable caches when native history cannot be read again. |
| Attachments and artifacts | An explicit owner defines retention; a path that expires with the process is not sufficient durable storage. |

Storing both native history and display history is valid when their roles are explicit. Two authoritative writers reconstructing the same native fact from one another are the problem. Deleting display history does not delete native context; normalized readable content does not promise lossless restoration of arbitrary harness state.

Current Pi uses native `SessionManager` for files and branches, with an in-memory default when no manager is supplied. Pi Durable owns its native store and task recovery. Cherry selects storage locations and records product relationships; a future `DbService` relationship table does not replace either native format. This stack has not migrated desktop product-session tables or implemented Lane persistence.

### Preserve the three-package direction

| Location | Current responsibility |
| --- | --- |
| [agent-runtime](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime/README.md) | Common contracts, opaque IDs, and `ThreadFeed` observation delivery. No execution loop, SDK, Electron, AI SDK, or product entities. |
| [agent-runtime-pi](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi/README.md) | Pi coding-agent access and our Pi-specific goal, tools, and subagent extensions, using native sessions and storage. |
| [agent-runtime-pi-durable](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi-durable/README.md) | Independent integration with Pi Durable's `Harness`, conversation and task APIs, scheduler, and storage. |
| [Cherry model bridge](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/src/main/ai/runtime/pi/README.md) | Host model selection and native Pi provider registration against the internal gateway. Pi retains protocol streaming, replay and the tool loop; Cherry retains credentials and provider-call billing. |

Pi Durable is a separate execution system, not a persistence switch on coding-agent. Both adapters depend on the common package and do not depend on each other. Pi's session owns request retries; the native HTTP client and internal gateway do not add retries or execute Pi's tools. Native compaction, verifier context, and child continuation use native messages and managers, not reconstruction from public display items.

The desktop services still use their existing runtime path. The [runtime contract](2026-10-17-agent-runtime-contract.md) records the implemented access protocol and its limitations; the [harness evidence note](../testing/2026-10-17-agent-harness-evidence.md) separates five native samples, historical probes, source coverage, and remaining acceptance. The [goal note](https://github.com/CherryHQ/cherry-studio/pull/21607) and [background subagent note](https://github.com/CherryHQ/cherry-studio/pull/21693) own the Pi-specific decisions.

### Use native Pi providers through the internal gateway

The approved deletion removes the host `ModelCallPort`, custom AI SDK stream protocol, metadata codec and binding-enforced session settings. The host registers a native Pi provider against the existing internal gateway. Gateway execution owns provider credentials and billing; native session events own display usage. This change does not redesign the gateway pipeline. Preserve tool ownership, native history, compaction, abort and retry behavior with HTTP integration tests, then verify the desktop cutover in its owning layer.

## Alternatives considered

- Make the common runtime a second session engine: rejected because reimplementing native queues, retries, history, and recovery creates competing execution owners.
- Make every product session or parent tool message the native context identity: rejected because multiple native contexts, retained children, and background output have independent lifetimes.
- Normalize all tools, storage formats, and native capabilities up front: rejected because matching method names does not establish equivalent semantics; typed adapters preserve the differences.
- Use one transcript as both UI archive and native recovery format: rejected because display data omits native context and execution state, while some native histories cannot be reread.

## Acceptance criteria

Existing package boundaries are source evidence, not completion of the remaining host integration. These criteria define what that integration must preserve.

- AC1 — The common package remains independent of native SDKs, Electron, and product entities; the proposed standard AI SDK content dependency is permitted, and the adapters have no dependency on each other. (verification: unit — package typechecks and dependency-boundary checks)
- AC2 — Releasing a window access does not stop another observer or a retained child; child output remains addressable after the parent message ends. (verification: Electron — host projection and multi-window integration)
- AC3 — Reopening native context uses its native storage and explicit product relationship, without recreating it from display history or treating missing storage as a new context. (verification: unit — adapter storage and host relationship tests)
- AC4 — Native and host-owned delegations each have one result-delivery owner, with no duplicate delivery caused by observing completion. (verification: unit — adapter and host orchestration tests)
- AC5 — Integration documentation distinguishes package source coverage, native recovery guarantees, and actual desktop acceptance. (verification: docs gate — runtime notes and module READMEs)

## Risks

Thin access contracts can still conceal native side effects if adapters omit their scope. Durable scheduler activation, Pi preflight cancellation limits, content identity resets, and unavailable child input need explicit behavior descriptions. Native formats and normalized archives may both consume storage, but removing one without its recovery or presentation owner can lose data. The proposed host projection and relationship model still need concrete integration acceptance before these notes move to implemented.
