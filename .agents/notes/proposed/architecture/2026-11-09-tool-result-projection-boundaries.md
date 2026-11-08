# Agent Note: Tool result storage, projection, and detail boundaries

Status: proposed

English | [中文](2026-11-09-tool-result-projection-boundaries.zh.md)

## Problem

Users need to open and close tool cards while an Agent continues streaming. Complete tool outputs currently participate in work that only changes text. Deferring renderer transport reduces that work but leaves storage reads, result projection, detail loading, and delivery subscriptions with different boundaries.

At the inspected baseline `c9426d07704407106e23f03ee6aca9e3938df8ef`:

- `TopicMessageProjection.publish` projects accumulated messages again for each flushed batch. `projectToolOutputForRenderer` serializes and hashes oversized results again.
- `MessageProjection.flush` clones and deeply compares the entire next view before deriving append patches. Moving this cost to Main does not make publication incremental.
- `useResolvedToolResponse` starts `useToolResult` when a tool component mounts. Loading details temporarily changes the displayed tool status to `invoking`, and a read error changes it to `error`.
- `useToolResult` keys its immutable cache by output revision, but `ai.tool.get_result` omits that revision from its request. The handler can therefore read a replacement value for a request associated with an older cache key.
- Completed-state immutability is not an established producer contract. Pi preserves preliminary results, and existing projection and hook regressions explicitly support replacement output under the same message and tool call.

This note specializes the payload and consumer boundaries of the [runtime contract](2026-10-17-agent-runtime-contract.md). It preserves native execution, archive ownership, and ordered projection delivery. [PR #23873](https://github.com/CherryHQ/cherry-studio/pull/23873) is the separate storage repair under review, not shipped evidence or approval of this proposal.

## Proposal

### One result identity and one delivery sequence

A tool call is identified by its product conversation, message, and tool call. An output value is identified by that call plus its existing content revision. Keep the wire field `revision`; do not add another counter, rename the hash to an output ID, or treat a tool completion state as proof that replacement is impossible.

The output owner creates an immutable accepted result value. It serializes that value once, calculates its existing SHA-256 content revision, and derives the bounded preview at result acceptance. Storage and projection reuse those products. Text appends, disclosure changes, and repeated publication do not revisit the full result. Producer integrations must establish this boundary even when a native source mutates objects in place. Object identity alone is not evidence of unchanged content.

A changed preliminary or replacement result obtains a content identity for its changed value. Replayed identical content keeps the same revision. A native snapshot can require reconciliation once on attachment or source replacement; ordinary text changes do not trigger that reconciliation. No new immutable-result exception is inferred from `output-available`.

`MessageProjectionUpdate.revision` remains a contiguous publication sequence scoped to its publisher and subscription. It detects duplicates and gaps. It never identifies a tool output or authorizes a storage write.

### Existing owners keep their resources

| Owner | Responsibility |
| --- | --- |
| Runtime adapter | Reports native content and actual replacement boundaries. It does not own Cherry's database, renderer cache, or display budgets. |
| `AiStreamManager` and the bound live projection | Hold accepted live result values until durable handoff. Lookups include the captured product message and attempt, not just a reused tool call ID. |
| `AgentSessionMessageService` | Owns persisted result bytes, the result reference in message data, atomic writes, full reads, and cascade cleanup. |
| `MessageProjection` | Publishes a compact immutable view and affected patches. It owns delivery ordering, not tool execution or detail storage. |
| Renderer detail consumers | Own disclosure, detail read state, and a bounded shared detail cache. They never insert hydrated output into streaming message parts. |

Live and persisted copies use the same content revision across handoff. Persist the new reference and its result atomically. Release the live copy only after durable handoff or an explicit unavailable outcome. A failed archive write remains a persistence failure and does not repeat the tool operation. Shutdown drains accepted writes under the existing runtime barriers.

Use the sidecar layout from #23873 if it lands, or carry its narrowly scoped storage repair as the first implementation layer. Regenerate a new appended migration against the implementation base; the proposal does not reserve that PR's migration number or modify its branch. Keep legacy inline rows readable. Split them when written, without a startup backfill.

Compact message paging does not read the result table for split rows. Full model context, resume, fork, diagnostics, and explicit full-content consumers hydrate only when their contract requires it. Existence checks and projection bookkeeping must not accidentally select or hydrate result bodies.

### Version-aware reads with explicit purpose

Extend the existing `ai.tool.get_result` route with a required read purpose and the expected result revision. Migrate every caller in the same layer. Use a discriminated request for `preview`, `text-range`, or `full`, and a discriminated response for `ready`, `pending`, `stale`, or `unavailable`.

| Read purpose | Consumer and bound |
| --- | --- |
| `preview` | A typed tool presentation, citation preview, or active artifact consumer. The serialized response is at most the existing 32 KiB tool transport budget. Images and other large assets use resource references. |
| `text-range` | An expanded raw-result viewer. Each response contains at most 256 KiB of UTF-8 text, a validated next cursor, and the resolved revision. |
| `full` | An explicit full-content operation such as image export or copy. It preserves the original typed value and is not called by ordinary card mounting. |

These bounds are initial design limits, not measured performance results. Text ranges preserve Unicode boundaries. The range path reads a bounded segment of stored serialized bytes; it does not parse and format the complete object before truncating it. Retain raw typed bytes for model and full-content readers.

The owner checks scope and expected revision against the value it actually serves. If A was requested and only replacement B remains, return `stale` without B's body. Do not archive every output version to satisfy old reads. Renderer refreshes the affected reference and starts a separate request for B. A late A response cannot populate B's cache or replace B's display.

An old persisted reference without a revision uses a non-immutable discovery read to obtain the current compact reference first. Never permanently cache a latest-value read under an unversioned key. `pending` represents an accepted value whose reader is not ready; it is not cached as permanent absence. `unavailable` is a detail outcome, not evidence that the tool failed.

### Separate detail state from execution state

Generic collapsed cards use metadata and bounded previews without fetching a full result. Mount a detail consumer only when expanded. Closing a card releases its detail subscription and prevents a late response from reopening or overwriting it.

Keep the tool's execution state from its accepted runtime part. Model detail state separately as `idle`, `loading`, `ready`, or `error`. Loading, stale reads, missing details, and detail errors never turn a successful tool into an invoking or failed tool. Read failures do not retry execution.

Audit the current consumers explicitly:

| Consumer | Target behavior |
| --- | --- |
| `useResolvedToolResponse` and generic tool cards | Remove the eager full-result gate. Request bounded presentation only for visible content, and text ranges for expanded raw details. |
| `AgentRightPane` child-flow panel | Subscribe to its existing child projection. Fetch only result-dependent preview fields while the panel is active. |
| `useAgentPreviewUrl` | Resolve a preview resource while its consumer is active. Do not hydrate unrelated tool output. |
| Citations, specialized cards, and image presentation | Use bounded typed previews or resource readers. Preserve source identities and ordering. |
| `markdownImageExport`, full copy, model context, and resume | Use explicit full-content reads. Do not export the deferred marker or silently replace complete output with its preview. |

Keep one detail cache per renderer window, keyed by result identity and read purpose or range. Cap cached serialized payloads at 16 MiB using LRU eviction. A value larger than the cap is not retained. Remove a conversation's inactive entries when its last consumer releases them; one panel closing must not clear another active panel's data. Cancel or detach obsolete reads, and fence late completions by conversation, result identity, and request generation.

The 16 MiB cap applies to retained cache payloads, not a claim about total JS heap or DOM memory. Do not layer an additional unbounded SWR full-result cache under this budget.

### Make publication and subscriptions incremental

Retain the existing `CherryUIMessage`, `ai.projection` transport, attach handshake, and gap recovery. Accepted result values and published parts are immutable after their owning boundary. Replace only changed paths and preserve settled part identities. Establish that invariant in root and child producers before removing the protective whole-view clone.

Generate append or replacement patches from accepted changes. Ordinary text publication must not clone or deeply compare every accumulated message, serialize settled tool results, or rebuild an unchanged order array. Real content replacement, reordering, attachment, and recovery can still publish the affected replacement or a new baseline.

Renderer keeps stable structure for pure text updates. Text consumers subscribe by message and part. Tool consumers subscribe to their own state and compact result reference. Unrelated completed cards and historical rows do not update because another message grows. Preserve independent child ownership and the existing scroll runtime during disclosure changes.

### Delivery order and verification owners

1. Storage and accepted results. Integrate the storage repair and centralize result serialization, revision, and preview at actual change boundaries. Main data and runtime maintainers verify compact paging, populated-database migration, handoff, and replacement behavior.
2. Version-aware reads and bounded detail state. Migrate every route caller and remove the eager full-result gate in the same layer. IPC and renderer maintainers verify races, disclosure, specialized previews, export, and cache release.
3. Incremental publication and subscriptions. Change root and child producers together with affected renderer subscriptions. Runtime and renderer maintainers verify publication gaps, source replacement, stable consumers, and scroll ownership.
4. Electron acceptance and final documentation. The implementation owner records actual interaction traces, focused checks, remaining platform gaps, and AC evidence. Only this final layer moves the bilingual note to implemented.

Implementation PRs stack on the approved Spec and list their AC coverage. Every layer stays independently reviewable. Run tests with explicit affected file paths, scoped lint and formatting, and `docs:affected`; broader checks remain with CI. Do not claim a measured improvement from render counts or a mocked timing test.

## Alternatives considered

- Remove all output revisions and key immutable caches by call identity. Rejected because same-call replacement and preliminary results exist.
- Add a manually synchronized result counter or output ID. Rejected because it duplicates content identity without removing the acceptance and read-validation obligations.
- Hash complete results on each projection, or retain full results in renderer messages behind more memoization. Rejected because unchanged content still incurs copying, serialization, or comparison costs.
- Increase the DataApi timeout or always hydrate before truncating a preview. Rejected because neither bounds the synchronous work.
- Adopt T3's entire event log and turn-item storage model. Rejected because Cherry already owns runtime projections, patch delivery, and history. This proposal adopts the smaller boundaries.
- Retain old internal read APIs beside the new contract. Rejected because in-process callers can migrate together. Compatibility is required for persisted rows, not for superseded renderer APIs.

## Acceptance criteria

- AC1 — After an oversized result is accepted, pure text appends and repeated publication perform no new serialization, hashing, or preview extraction of that unchanged result; changed and replayed preliminary results preserve correct content identity. (verification: unit; Main runtime owner)
- AC2 — Split message paging and existence checks read no complete result bodies, while populated legacy databases migrate forward, retain full-reader output, and cascade-delete results with their messages. (verification: unit with setupTestDatabase; Main data owner)
- AC3 — A replacement during detail reads never serves B as A or caches one revision under another; stale, pending, unversioned, removed, and unavailable references produce the declared read outcomes. (verification: unit and renderer; IPC owner)
- AC4 — A collapsed generic card issues no detail read; expansion reads only its result, closing detaches the consumer, and detail loading or failure preserves the runtime execution state. (verification: renderer; tool presentation owner)
- AC5 — Preview and text-range responses respect 32 KiB and 256 KiB limits, preserve Unicode and resource references, and do not fully parse a stored oversized result before serving a text range. (verification: unit and renderer; Main data and IPC owners)
- AC6 — Detail cache payloads remain within 16 MiB, obsolete responses cannot revive a closed consumer, and releasing the last conversation consumer removes inactive entries without clearing another active consumer. (verification: renderer; cache owner)
- AC7 — Citation identities and numbering, specialized cards, active child panels, preview resources, image export, full copy, model context, resume, and fork retain their complete-content or bounded-preview contracts. (verification: focused unit and renderer tests plus Electron scenarios; affected consumer owners)
- AC8 — Pure text publication uses affected patches and stable list structure without whole-view cloning or deep comparison; root and child attachment, duplicate delivery, gaps, replacement, shutdown, and persistence failure preserve their existing contracts. (verification: unit and renderer; projection owners)
- AC9 — During sustained streaming, twenty expand-close cycles for each of 256 KiB, 2 MiB, and 16 MiB settled result fixtures have p95 input-to-visible-disclosure latency at most 100 ms, with no renderer task of at least 50 ms attributable to repeated processing of the unchanged result; record hardware, build, workload, Main and renderer traces, and a separate real-Agent run. (verification: Electron; implementation owner)
- AC10 — All internal result-read consumers use the explicit-purpose contract, the old eager full-result gate is removed, and both language documents describe the final verified behavior without presenting fixtures or component tests as full system acceptance. (verification: source audit and docs gate; implementation owner)

## Risks

- Native producers may mutate or replace already completed-looking values. The acceptance boundary must prove immutability before removing copying. Do not infer that property from terminal display state or a WeakMap key.
- A finite detail cache cannot make arbitrarily large full-content operations cheap. Explicit full reads can still allocate large objects and require separate profiling if they affect responsiveness.
- Legacy inline rows still require parsing until rewritten. The no-sidecar-read guarantee covers split rows; this proposal does not hide that compatibility cost.
- The initial response and cache limits can affect large structured presentations. A failing required consumer needs an explicit typed preview or resource reader, not an unbounded generic bypass.
- #23873 can change before implementation, and Main already has newer migration numbers. Reconcile its actual merged contract and regenerate migrations rather than copying a numbered migration.
- The Electron latency criterion is a proposed acceptance target. No performance trace or speedup has been measured for this proposal.
