# Agent Note: Harness-owned context usage

Status: proposed

English | [中文](2026-10-30-agent-context-usage.zh.md)

## Problem

The desktop context panel currently consumes `AgentSessionContextUsage`, a host type shaped around Claude's native response. Claude exposes its SDK response through `handle.claude.contextUsage()`, Pi exposes a different native reading through `handle.pi.contextUsage()`, and Durable exposes neither. Renderer code recognizes English category names, interprets deferred tools, and resolves model-window differences. A shared-looking UI therefore does not establish a shared harness capability.

This proposal partially supersedes the [runtime contract](2026-10-17-agent-runtime-contract.md) statement that context usage stays in the Pi-specific facet. Native execution, input, history, billing and compaction ownership remain unchanged. It extends the common observation boundary; it does not move context management policy into the renderer or `agent-behavior`.

## Proposal

### Public boundary and ownership

`@cherrystudio/agent-runtime` owns the context-usage types and a required read operation on `ThreadHandle`:

```typescript
contextUsage(): Promise<OperationResult<ThreadContextUsage>>
```

Every concrete runtime implements this operation. It is a passive read: it does not submit input, run tools, compact history, resume a Durable scheduler, or charge a model request. A released handle returns `rejected`; unsupported native access, including a child the native API cannot inspect, returns `unsupported`. A temporarily unavailable measurement is `unknown`, not a zero reading. The existing `OperationResult` vocabulary remains authoritative.

The adapter translates native data into the common contract. Main supplies the resolved model capacity and resource provenance when it configures a runtime, then handles product-session association, caching and refresh coordination. Main must not overwrite the returned denominator by guessing from a model-name prefix. Renderer translates common category keys, formats numbers, and renders resource lists; it imports no native SDK types and contains no native English-name classification.

`agent-behavior` continues to own decisions such as compaction and goals. It does not own this read-only presentation capability, nor infer monetary usage from context occupancy.

### Reading semantics

| Field | Contract |
|---|---|
| Model identity and context revision | Identify the model and native context boundary the reading describes. The adapter's opaque revision changes when model configuration or selected context changes. A host connection epoch also fences replaced accesses. |
| Full context window | The usable model window after native capability restrictions, before output or compaction reservations. Host catalog capacity alone cannot enlarge a native plan limit. |
| Input limit and compaction threshold | Separate optional limits. They are not alternate names for the full window and need not be additive reservations. |
| Used tokens | Current occupancy with `reported` or `estimated` provenance and a basis of current context or last model request. An unknown current value remains absent. Provider invocation totals across turns are never occupancy. |
| Reserved and free tokens | Optional allocation facts in the same full-window units. Only known, non-overlapping reservations may be combined. Free space is derived only when all required allocation facts are known; a missing reserve is not zero. |
| Categories | Stable common keys, token counts, provenance, and `included` or `deferred` occupancy. Missing breakdown means unavailable; an empty supported breakdown means no entries. Partial coverage is explicit. |
| Resources | Native resource identity, category, display name, source, optional token count and optional loaded/deferred state. Missing information stays absent. A resource list explains categories and never adds to the total a second time. |

Common categories cover messages, system prompt, system tools, MCP tools, MCP instructions, memory files, skills and custom agents. An `other` category preserves an adapter-provided stable ID and label for extensions. Buffer and free space are allocation fields, not message/tool consumption categories. Deferred schemas have no window share and never enter the occupancy bar.

A reported total can coexist with estimated category counts. The adapter marks their provenance and coverage; it must not force them to sum by inventing residual categories or proportionally rescaling them. When complete counts share a measurement basis, their sum must match the used total. All displayed percentages use the full window returned in the same reading.

### Adapter implementation

| Runtime | Implementation boundary |
|---|---|
| Claude Code | Normalize `Query.getContextUsage()` inside `agent-runtime-claude-code`. Map native stable IDs/kinds and resource lists there; retain native-name compatibility only inside this adapter. Resolve declared gateway capacity versus native plan limits explicitly. The observed gateway `maxTokens` and `rawMaxTokens` can both be a reduced budget, so neither is unconditionally the full window. |
| Pi | Use `AgentSession.getContextUsage()` for its native occupancy estimate and model window. Derive additional categories only from the actual native prepared system prompt, active tool schemas and projected context, using native estimation facilities. Preserve resource provenance from the loader. If the public API does not expose a coherent prepared context, add the upstream read surface rather than reconstruct it in Main. |
| Pi Durable | Add a passive native reading at the context-preparation boundary used by generation and threshold compaction. Reuse its selected context range, resolved model, tool filtering/loading and `estimateContext` semantics. Expose this through the Durable public API and normalize it in `agent-runtime-pi-durable`; do not import private dependency paths or reimplement generation in Cherry. |

Pi's current native implementation can report unknown occupancy immediately after compaction until a subsequent response. This is a valid state to preserve. Durable already estimates context for compaction internally; the missing public read API is an upstream capability gap, not a reason to permanently omit Durable from the common contract. Any necessary pinned dependency patch is scoped to that native read surface and must have upstream-level tests.

### Refresh, isolation and migration

Readings belong to their accessed thread, including children where supported. They never borrow the parent's reading. The adapter captures a coherent context revision for each read; if the native source cannot establish one, it returns an unavailable or explicitly stale result instead of combining states. Main rejects a completed read from a replaced connection, model or selected branch.

Refresh on attachment, completed model output, tool/resource configuration changes, successful or no-op compaction, native reset and branch selection. Existing native live readings must also pass through adapter normalization. Live delivery uses a `context.changed` event carrying the same operation result on the existing observation stream, and the thread snapshot includes the latest context reading. It must not establish a second subscription owner. Repeated unchanged reads publish no new change.

After compaction, reset or model change, obsolete counts are invalidated immediately. A transient refresh failure may retain a clearly stale last reading only for the same context revision; it cannot silently retain the former model's value. Single-flight refresh and trailing refresh must preserve the final current reading without polling loops.

Replace the host DTO and native facet usage paths with the common contract. Move the renderer's native category normalization into the Claude adapter, move denominator resolution into configured runtimes, and migrate the composer and status pane together. No persisted billing data or SQLite migration is required. The previously implemented resource UI remains, but consumes neutral resources and category keys.

### Delivery and verification

This Spec is a follow-up layer above the existing desktop integration. After approval, deliver the common contract and all three adapters with native dependency changes, then the desktop consumer migration. Keep the existing stack base and PR states. Do not claim complete acceptance while any runtime is only a stub returning unsupported for its root reading.

Use real native loops with deterministic model endpoints for the three adapter suites. A single contract matrix covers coherent denominators, unknown/estimated data, deferred resources, passive reads, child isolation, compaction, fork/rewind, model changes, release and reopen. Test native packages where the missing read capability is implemented. Renderer tests use the same neutral fixture shape without a runtime selector. Electron then checks actual root/child panels, live refresh and unchanged billing on reads.

## Alternatives considered

- Keep the Claude-shaped host DTO and add runtime branches in Renderer: rejected because native interpretation and missing capabilities remain outside their owners.
- Sum visible transcript tokens or invocation-ledger rows: rejected because projected display history, request-time context and cumulative billed usage differ.
- Return empty categories or zero for every unsupported measurement: rejected because unavailable and measured-empty have different user meaning.
- Build a generic tokenizer or new context manager in the shared package: rejected because native preparation, multimodal accounting and compaction already own those decisions.
- Add a separate context-usage event bus: rejected because thread access and observation already define identity and lifetime.

## Acceptance criteria

- AC1 — All three adapters expose the same required passive context-usage operation; missing, released and unsupported child access return explicit outcomes without model/tool work. (verification: unit — shared contract matrix over real adapters)
- AC2 — Claude native, Claude gateway and Pi model readings distinguish full window, input limit and compaction threshold; the composer and details use one denominator, including the observed 854560-budget/1000000-window gateway case. (verification: unit — adapter fixtures and renderer integration)
- AC3 — Pi and Durable supply real root readings from native context preparation; estimated and post-compaction unknown values remain distinguishable, and no root implementation is an unconditional unsupported stub. (verification: unit — native package and adapter integration)
- AC4 — Included, deferred, reserved and free tokens do not double count; partial breakdowns and unknown allocation facts remain explicit, while resource lists preserve identity, provenance and loading state. (verification: unit — native fixtures and common semantic matrix)
- AC5 — Child reads remain thread-scoped; compaction, reset, fork/rewind and model changes invalidate old readings, and late reads from replaced connections cannot overwrite current state. (verification: unit — native transition and host race tests)
- AC6 — Main and Renderer contain no native category-name matching, SDK response types or runtime-specific denominator guesses; existing live and post-turn paths use the same neutral contract. (verification: unit — consumer integration and source-boundary checks)
- AC7 — Repeated unchanged reads do not create event feedback loops, start native execution, or add billing records; close/reopen retains native ownership and releases observers. (verification: unit — real adapter lifecycle and ledger integration)
- AC8 — Actual Pi, Durable and Claude sessions render supported categories/resources and explicit unknown states consistently in the composer and status pane, including narrow layouts and light/dark themes. (verification: Electron — per-runtime root/child and transition matrix)

## Risks

Native APIs differ in what they can measure, especially resource attribution, multimodal tokens and child control. A uniform interface cannot manufacture equivalent precision. Native preparation may contain injected or filtered content absent from host resource configuration; only observed inclusion justifies a category count.

An upstream read must remain passive and avoid holding a write transaction while doing expensive estimation. Large histories require native revision-based reuse rather than repeated full scans. Capacity restrictions and overlapping reserve policies require explicit native evidence. Exposing filenames and tool sources follows the existing authorized session boundary; this change does not grant filesystem access.
