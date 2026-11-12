# Agent Note: Bind session runtimes before unifying Agents on Pi Durable

Status: proposed

English | [中文](2026-11-12-session-runtime-binding.zh.md)

## Problem

Agent sessions currently select their execution driver from the mutable Agent `type`. Updating every Agent to `pi-durable` would therefore route old Pi and Claude Code histories into a different engine. The user requires native continuation of those histories, Pi Durable for all fresh conversations, and no runtime display in Agent creation or editing forms.

The inspected baseline is `bc215da7204393c838b92bd19a4cfad20ec7d78d`. `AgentChatContextProvider`, `AgentSessionRuntimeService` and `AgentSessionForkOperations` select drivers through the Agent. `agent_session` has no runtime field, although existing contexts refer to a backend whose locator records its kind. Contexts are not guaranteed to exist for every legacy or empty session. The creation wizard already defaults to Pi Durable and hides runtime; the editor still renders a runtime summary.

This proposal supplements the [runtime contract](2026-10-17-agent-runtime-contract.md) and [history operation boundaries](2026-11-08-agent-history-operation-boundaries.md). It does not replace native backend identity or authorize deleting the legacy drivers.

## Proposal

### Persist session ownership before changing Agents

Add a persisted `runtimeType` to the session schema and shared session entity. It is immutable after allocation and represents execution ownership, not a user-editable setting. Existing backend locators remain authoritative for native storage identity; they must agree with session ownership. Do not manufacture a native context merely to record a runtime.

Use a new appended schema migration and an ordered, transactional data upgrade before sessions can execute. Bind every existing session before normalizing any Agent type. Derive a session's runtime from existing context/backend evidence when present, otherwise from its pre-upgrade Agent. Preserve known pending retired-runtime conversions and their target ownership; do not reinterpret their old resume tokens. Inspect the existing retired-runtime and context seeders and order this upgrade after the migrations that establish their ownership.

Include soft-deleted records so restore does not change engines. Preserve already recorded bindings on retries. Unknown, conflicting or orphaned histories without sufficient evidence remain unresolved and non-executable; never guess Pi Durable for them. Use an explicit unresolved representation instead of a schema default that silently labels old rows. An unresolved session must not prevent unrelated valid sessions from upgrading. No transcript, native store, checkpoint, resume token or attachment is converted or discarded.

After bindings are captured, normalize existing Agents to `pi-durable` in the same transactional upgrade. Preserve IDs, model choices, instructions and configuration. New Agent creation, duplication, import, built-in seeding and updates must converge on Pi Durable at the data owner, not only in the wizard. Backup restoration and legacy imports must bind sessions before normalizing their Agents, and preserve explicit bindings. Existing Agent configuration continues to supply models and tools; runtime capability interpretation follows the session's engine.

### Route execution and presentation by session

Fresh conversations use Pi Durable, including task/channel-created conversations. A reused legacy conversation retains its original runtime. Forks, edit-and-resend branches and child contexts inherit their source execution ownership; they are historical continuation, not fresh conversations. Binding must be committed with session allocation, including headless entry points.

Resolve the driver from session ownership in dispatch, warm connection, recovery, history actions, fork publication checks, diagnostic access and runtime cleanup. Session capability consumers in the renderer must use the same ownership for commands, permissions and history actions. Continue reading shared Agent settings without allowing the upgraded Agent type to override session execution. Backend/session disagreement fails explicitly rather than opening another store. Deleting an Agent does not invent replacement configuration for its orphan sessions.

Keep Pi and Claude Code adapters available for old sessions and their native history operations. Product development for fresh main-Agent conversations can focus on Pi Durable, but compatibility fixes and dependencies for old engines remain necessary. This change does not claim that only one runtime remains in the application.

### Remove form runtime display

Keep runtime absent from creation and remove the editor's runtime summary and hint. Remove presentation helpers only if this change leaves them unused. Preserve the rest of the forms and settings; do not introduce a replacement runtime badge or selector. Session controls continue to reflect their actual engine even when their owning Agent now has type `pi-durable`.

## Alternatives considered

- Update only Agent types: rejected because dispatch would choose the wrong engine for saved history.
- Infer ownership only from context/backend rows: insufficient for empty sessions and histories without a recorded context; retain native evidence and add explicit session ownership.
- Convert all native histories into Durable: rejected because product message projections do not encode native checkpoints, task graphs or recovery state.
- Make old histories read-only: rejected by the user, who explicitly chose native continuation.
- Keep all runtime configuration visible: unnecessary for fresh conversations once the data owner enforces Pi Durable.

## Acceptance criteria

- AC1 — A populated database upgrade preserves Pi, Claude Code and Durable session ownership before all existing Agents become Pi Durable, including soft-deleted rows; rerunning or interrupting the upgrade cannot overwrite ownership or partially normalize Agents. (verification: implementer, real SQLite migrate-forward and transaction/retry tests)
- AC2 — Empty legacy sessions bind from their pre-upgrade Agent; existing backend evidence and pending retired-runtime conversion ownership survive; conflicting or unknown orphan histories stay readable but cannot execute under a guessed engine. (verification: implementer, real SQLite migration and session-routing tests)
- AC3 — Fresh interactive, task and channel conversations execute through Pi Durable; legacy reuse, fork, edit-and-resend and child operations retain their original engine and native identity after Agent normalization and process reopen. (verification: implementer, affected Main contract tests and isolated Electron continuation for each engine)
- AC4 — Dispatch, prewarming, recovery, diagnostics, cleanup and renderer capability controls agree with session ownership, and a conflicting native backend is rejected without creating or replacing storage. (verification: implementer, focused Main and renderer contract tests)
- AC5 — Creating, editing, duplicating, importing and reseeding Agents cannot reintroduce another Agent type; both creation and editing forms show no runtime selector, summary or hint. (verification: implementer, data-owner tests and real-component form tests plus isolated Electron inspection)
- AC6 — Backup export/restore and supported legacy imports preserve messages, attachments, native identities and runtime bindings; old sessions still continue and fresh sessions use Durable. (verification: implementer, populated database import tests and isolated Electron backup round trip)

## Risks

Legacy adapters and their dependencies remain required. Shared Agent settings can have engine-specific interpretation, so hiding runtime must not hide required legacy session capabilities. Import, restore, fork and background-session allocation are separate write paths and must not bypass binding. Existing pending retired-runtime conversions require explicit ordering before Agent normalization. Real-provider continuation and backup evidence are required in addition to focused tests; this Spec contains source inspection only and no implementation acceptance evidence.
