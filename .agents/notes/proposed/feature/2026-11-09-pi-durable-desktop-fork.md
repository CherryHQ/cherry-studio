# Agent Note: Pi Durable desktop forks share one backend owner

Status: proposed

English | [中文](2026-11-09-pi-durable-desktop-fork.zh.md)

## Problem

Pi Durable has native same-storage forks, but desktop replies carry no fork checkpoint and its driver has no fork implementation. Adding that method alone would let two desktop connections independently open and shut down Harnesses over the same storage. Desktop gateway headers, approvals, environment and behavior callbacks also currently capture one product root.

Separate product conversations do not require separate databases. This proposal replaces only the isolated-target-backend prerequisite in [the history-operation proposal](../architecture/2026-11-08-agent-history-operation-boundaries.md). Its requirements for native history, explicit ownership, failure handling and file-state preservation remain. No new upstream SDK behavior patch or dependency upgrade is proposed.

## Proposal

### Scope

Enable the existing desktop **Fork** action for successful Pi Durable replies with a newly captured native checkpoint. Reuse the source backend for its fork lineage; unrelated roots keep their existing backends. This is not an application-wide storage migration. File rewind and Pi Durable **Edit and resend** remain outside this delivery.

Existing native `Conversation.fork()` / `tx.forkConversation()` create an ownerless conversation at a concrete entry. Native fork rules retain the prefix and historical agent configuration, initialize fresh provider/live state and preserve document fork policies. Keep these decisions inside the SDK.

### Backend ownership and root isolation

Move native runtime creation and final shutdown from individual `PiDurableRuntimeConnection` instances to a backend-scoped resource owned through the existing driver/runtime-service lifecycle. Keep one initialization promise and one native owner per backend, including overlapping opens, fork preparation and close/reopen. Connections borrow a root handle and own only their observation, product projection and root host resources. Releasing one connection cannot shut down or reconfigure its peers. Final release joins native work, drains observations and closes the backend once; an acquisition racing with final shutdown waits for that shutdown before reopening.

Do not introduce a generic runtime manager, another scheduler or application-wide database singleton. The existing runtime already supports multiple `open()` accesses; expose its native fork through the Pi Durable facet rather than adding fork to the harness-neutral Runtime contract.

Dispatch host behavior by the actual native conversation and its ownership tree. Gateway identity, model parameters, trace, usage callbacks, approvals, questions, attendance, workspace, skills, MCP and environment must resolve to the correct product root, even when that root is the only open member of a previously forked lineage. Use public native environment and extension-selection APIs. Do not overwrite a shared provider/extension registration with whichever root connected last, or route all roots through the first connection's closures. Refactor shared behavior host selection only where its current single-root assumption prevents this explicit routing.

Restore host bindings needed by retained native work before enabling the shared scheduler. Closing a root must not leave active work using disposed host resources; retained work keeps its owner, while explicit user Stop remains conversation-scoped. A backend failure reaches every affected access. Backup/shutdown join and close the shared backend once rather than waiting for one root to stop its unrelated peer.

### Checkpoints and native forks

Capture the concrete committed entry in the same atomic native observation batch that establishes foreground completion. Add an opaque Pi Durable checkpoint containing backend, conversation and entry identity; preview content or idle activity cannot establish that boundary. Missing evidence leaves a completed answer readable with Fork unavailable. Existing replies without such checkpoints stay unsupported.

The driver validates checkpoint ownership and invokes the live backend owner's public native fork. A cold operation acquires that same backend resource without submitting input or resuming its scheduler merely to read/fork history. It never starts a competing Harness. Return the new conversation identity and retained checkpoint mappings; the new product context keeps the original backend ID. Checkpoint resolution must include backend identity because native numeric IDs are not globally unique.

Retained older checkpoints continue to address native ancestors in the same store. The source may append after the selected entry; those later entries do not enter the fork. A copied system workspace still reflects its current files; ordinary workspaces remain shared. Neither behavior restores files at the selected historical entry.

### Publication, failure and deletion

Reuse `AgentSessionForkOperations` and `AgentSessionForkService` for workspace preparation, source-prefix revalidation and atomic product session/message/context publication. Record the prepared native conversation in the existing operation resource record, with its backend and operation identity. Do not publish a product session until native preparation is confirmed.

Native and product SQLite commits cannot form one transaction. If publication fails or the operation is cancelled, no product fork becomes visible and existing source/peer state remains unchanged. A confirmed prepared conversation without a product binding stays inert and identifiable for recovery. Pi Durable has no public conversation-deletion API; retain that native orphan rather than truncating tables, deleting the shared store or inventing compensating SDK behavior. An uncertain native commit is reconciled by the operation marker before retrying creation. Workspace cleanup still removes only proven operation-owned unpublished files.

Deleting or closing a source product session removes its product resources, not the shared native ancestry still required by a fork. Keep the backend while any surviving context references it. Do not add a new native-history pruning policy in this feature.

Adding `driver.fork` must not accidentally enable Durable Edit and resend through the current shared eligibility check. Preserve its unsupported result until that operation has its own verified binding/publication contract. Claude and Pi eligibility and persisted checkpoint formats remain unchanged.

### Implementation owners

| Owner | Change |
|---|---|
| `packages/agent-runtime-pi-durable/src/projection.ts`, `runtime.ts` | Committed completion checkpoint and typed native fork access through the existing owner |
| `src/main/ai/runtime/piDurable/PiDurableRuntimeDriver.ts`, `PiDurableRuntimeConnection.ts` | Backend lifetime, per-root access/host routing and native fork/checkpoint validation |
| `src/main/ai/runtime/piDurable/durableDesktop.ts`, existing Pi gateway/behavior host helpers | Conversation-correct provider, extension, environment, approval and usage ownership |
| `src/main/ai/agentSession/fork/AgentSessionForkOperations.ts`, `resources.ts` | Prepared native-operation identity, reconciliation and product publication without deleting shared storage |
| `src/main/ai/agentSession/durableNativeContext.ts`, context/fork services | Recover native fork markers and publish the existing backend with the new conversation/context |
| `src/main/ai/agentSession/fork/historyActions.ts` | Enable evidence-backed Fork while keeping unimplemented Durable editing unavailable |

### Delivery and validation

Implement native checkpoint/fork access first, then backend/root ownership and product publication, and finally desktop eligibility. Keep the note proposed until all acceptance criteria have actual evidence. Run explicit package/Main/renderer test files covering changed consumers; leave broad suites to CI.

A local public-API probe on baseline `c8cb24e988482bfee2c4041f11c0bf6400768859`, using the installed patched Pi Durable 1.5.0 and real native SQLite, already demonstrates same-store native fork, historical `AgentDoc`, independent parent/child appends, ownerless child identity and close/reopen. Its local artifact is `.context/cherry-electron-dev/durable-fork-native/result.json`. It makes no provider calls and is not desktop or real-model acceptance. No additional SDK patch was needed.

## Alternatives considered

- Separate database per fork: unnecessary for conversation independence and requires a new cross-storage SDK history/document transfer operation.
- Open another Harness over the source backend: creates competing native owners and does not fix root-specific host callbacks.
- Keep one root alive as the owner for all its descendants: closing/deleting that root would couple surviving forks to disposed product resources.
- Replay product text into a fresh native conversation: loses native history, compaction and document semantics.
- Copy or truncate the live SQLite store: duplicates unrelated task state and bypasses native ownership and history rules.

## Acceptance criteria

- AC1 — A successful Durable reply exposes Fork only with a committed, ownership-validated checkpoint; previews, legacy replies, malformed/foreign checkpoints and Durable Edit and resend remain unavailable consistently in listing and execution. (verification: package/Main/renderer tests — implementation author)
- AC2 — A fork sees exactly the selected native prefix and historical configuration, preserves compaction/document semantics and older inherited checkpoints, receives no source task/submission/approval authority, and excludes later source appends. (verification: real SDK SQLite tests — implementation author)
- AC3 — Concurrent root opens and fork preparation over one backend create one native owner; releasing, stopping, rebuilding or deleting one root neither stops a peer nor disposes its resources, and final shutdown/reopen has no overlapping owners. (verification: Main/native lifecycle tests — implementation author)
- AC4 — Concurrent parent/fork requests, tools and children use their own model options, gateway billing/trace identity, approvals, attendance, workspace, MCP and host callbacks; reconnect order does not change routing. (verification: Main gateway and behavior consumer tests — implementation author)
- AC5 — Product publication is atomic; cancellation, uncertain native admission, a failed product commit and restart recovery neither publish a partial product fork, duplicate a reconciled native fork, mutate peers nor remove shared native storage. Unpublished native orphans remain inert and identifiable. (verification: file-backed SQLite failure/recovery tests — implementation author)
- AC6 — After source-session deletion and application restart, the fork still opens, continues, and can fork an older retained checkpoint; shared backing history survives until no context claims it. (verification: Main/native tests and Electron — implementation author)
- AC7 — Real-model Electron acceptance creates a Durable fork through the existing UI, continues both conversations with separate answers and usage associations, closes/deletes the source, and resumes the fork after restart. Record the provider/model and distinguish these runs from scripted tests. (verification: Electron with configured real provider — implementation author)
- AC8 — Claude/Pi history behavior is unchanged, Fork does not imply file rewind, paired support documentation reflects actual delivery, and no new upstream SDK behavior patch is introduced. (verification: affected consumer tests and docs gate — implementation author and maintainer)

## Risks

- Host callbacks currently capture one root in several places. Sharing only the runtime object would create cross-session approval, workspace and billing bugs; AC4 is an enablement gate.
- Native storage and scheduler failure affects the entire backend lineage. The UI must receive truthful per-access failure; it cannot promise storage-level fault isolation between forks.
- Native fork ancestry retains source history and confirmed unpublished forks consume storage. No reclamation guarantee is added without a public native deletion contract.
- Registry/model selection and shared behavior changes can affect existing Pi consumers. Preserve their single-root behavior and verify the actual affected consumers rather than introducing fallback host selection.
- Cross-database publication needs reconciliation, not an exactly-once claim based only on a successful function return.
