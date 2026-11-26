# Agent Note: Tool result storage, projection, and detail boundaries

Status: implemented

English | [中文](2026-11-09-tool-result-projection-boundaries.zh.md)

## Problem

Users need to open and close tool cards while an Agent continues streaming. Complete tool outputs currently participate in work that only changes text. Deferring renderer transport reduces that work but leaves storage reads, result projection, detail loading, and delivery subscriptions with different boundaries.

At the inspected baseline `c9426d07704407106e23f03ee6aca9e3938df8ef`:

- `TopicMessageProjection.publish` projects accumulated messages again for each flushed batch. `projectToolOutputForRenderer` serializes and hashes oversized results again.
- `MessageProjection.flush` clones and deeply compares the entire next view before deriving append patches. Moving this cost to Main does not make publication incremental.
- `useResolvedToolResponse` starts `useToolResult` when a tool component mounts. Loading details temporarily changes the displayed tool status to `invoking`, and a read error changes it to `error`.
- `useToolResult` keys its immutable cache by output revision, but `ai.tool.get_result` omits that revision from its request. The handler can therefore read a replacement value for a request associated with an older cache key.
- Completed-state immutability is not an established producer contract. Pi preserves preliminary results, and existing projection and hook regressions explicitly support replacement output under the same message and tool call.

This note specializes the payload and consumer boundaries of the [runtime contract](../../proposed/architecture/2026-10-17-agent-runtime-contract.md). It preserves native execution, archive ownership, and ordered projection delivery. [PR #23873](https://github.com/CherryHQ/cherry-studio/pull/23873) is the first storage implementation layer above this Spec in the same stack. The implementation above that storage layer establishes the boundaries below. Final acceptance remains limited by the evidence under Verification.

## Decision

### Latest results and accepted native ownership

A call is addressed by conversation, product message and tool call. Preliminary or replacement output supersedes the current value; there are no historical outputs, content hashes, result revisions or version-addressed reads. `MessageProjectionUpdate.revision` remains the contiguous delivery sequence for duplicate and gap recovery.

Native `message.upsert` observations carry `changedParts` when the adapter knows the changed indexes. `snapshotRuntimeMessage` captures those indexes and reuses previous accepted untouched parts. Without a hint, it captures the complete message. Accepted JSON tool payloads and parts are deeply frozen and marked by their runtime owner; arbitrary object identity or `output-available` alone is insufficient. Decorators preserve untouched identities. Claude, Pi and Pi Durable report actual result changes, including preliminary replacements, through this boundary.

`AcceptedToolResults` uses the existing `snapshotToolPart` boundary and retains one accepted latest-value snapshot, compact renderer part and serialized UTF-8 buffer for the live root call. Immutable strings are shared rather than copied through `JSON.parse` after serialization. Pure text publication reuses accepted products. Range reads slice the owned buffer instead of re-encoding the complete live value on every open. Chunk result errors remove the prior accepted result and invalidate its reader. Lookups include the captured product message and live execution; after successful durable handoff they use persisted output instead. Failed persistence retains readable live content and does not retry the tool.

### Persisted bytes and explicit reads

`AgentSessionMessageService` stores one current output per message/call beside compact message data, atomically. Equal serialized bytes skip a result rewrite. Accepted unchanged parts reuse their serialized value; ordinary text changes do not rewrite settled sidecar rows. The database layer removes the result `revision` column through its generated migration. Legacy inline and persisted-blob envelopes remain readable, with no startup backfill. Split paging and existence checks do not hydrate the result table; full model context, resume, fork, diagnostics and explicit full consumers retain their existing hydration paths.

`ai.tool.get_result` requires a purpose and reads the latest value, ignoring a legacy reference's output revision:

| Purpose | Response and bound |
| --- | --- |
| `preview` | Typed output with `truncated`; serialized UTF-8 response at most 32 KiB. Large image bytes become an owned `cherry-media://tool-result/…` resource. |
| `text-range` | At most 256 KiB UTF-8 text with an optional validated byte cursor. Split SQLite values use a bounded `substr` read; legacy blob envelopes use bounded FileManager chunks. Legacy entity ranges show their skeleton and inline values followed by field-labeled blob text; inline values still require their existing full read. |
| `full` | Original typed value for an explicit operation such as copy or image export. Ordinary generic card mounting never requests it. |

The current handler returns `ready` or `unavailable`; `pending` remains a supported protocol state and is retried on relevant invalidation or reattachment. Availability never changes execution success, invoking or failure state. Resource reads validate the call identity and trusted renderer provenance, serve the latest image without an additional media payload store, and use `no-store`. A local read-generation change remounts image presentation. Full copy/export retains the original result.

### Detail ownership, invalidation and publication

The eager `useResolvedToolResponse` gate is removed. Generic cards mount their reader only while expanded and page raw text one displayed page at a time. Closing detaches the subscription and fences late completion. Expanded generic MCP cards also read bounded media previews. Meta-tool cards retain the original reference for explicit full copy. Specialized cards, citations and active result-dependent panes use bounded typed previews; details are not inserted into streaming message parts.

Each renderer has one 16 MiB LRU for serialized response payloads, keyed by call identity and purpose/range. Active reads deduplicate; superseded requests cannot repopulate the current cache or display. Oversized explicit full values reach the mounted requester without being retained in the shared cache. This budget does not bound total JS heap, DOM, active display objects or process RSS.

`MessageProjectionService` retains the actual displayed result owner. A child RPC is addressed through its parent, but cache ownership follows the installed child's archive `sessionId`. Reattachment, gaps, baseline replacement and post-commit persisted-message notifications invalidate that owner; the last observer releases its retained details without clearing another active observer. A late attachment cannot install an obsolete owner.

Result changes travel as targeted `tool-result` patches in the existing ordered batch, even when the compact part is unchanged. The renderer validates the update before invalidating details and notifying message consumers. Covered revisions do not repeat invalidation. Range invalidation resets pagination to byte zero; cursors do not pin history.

Publication reuses accepted unchanged messages and parts, emits affected append/replacement patches, and includes `order` only when membership or order changes. Renderer tool consumers subscribe to their own part so unrelated text does not update every settled card. Root/child runtime lifetime, scroll ownership, shutdown drains and failed-persistence semantics remain with their existing owners.

## Alternatives considered

- Keep historical results or content revisions to serve references to old output. Rejected because all consumers need the latest value or an explicit full read, not a past result. Same-call replacement requires cache invalidation, not version-addressed storage.
- Add a result counter, content hash, or new output ID to invalidate caches. Rejected because existing ordered projection delivery can carry targeted invalidation without another persistent identity.
- Hash complete results on each projection, or retain full results in renderer messages behind more memoization. Rejected because unchanged content still incurs copying, serialization, or comparison costs.
- Increase the DataApi timeout or always hydrate before truncating a preview. Rejected because neither bounds the synchronous work.
- Adopt T3's entire event log and turn-item storage model. Rejected because Cherry already owns runtime projections, patch delivery, and history. This proposal adopts the smaller boundaries.
- Retain old internal read APIs beside the new contract. Rejected because in-process callers can migrate together. Compatibility is required for persisted rows, not for superseded renderer APIs.

## Consequences

- Main retains an accepted snapshot and serialized buffer while it owns the active result. This removes repeated projection/range work; the serialized buffer still has a retained Main cost, while accepted immutable strings are shared. Successful durable handoff clears accepted-result ownership; failed persistence retains it for recovery.
- Full reads and old inline compatibility can still allocate or parse complete values. The cache budget and bounded response sizes do not promise a total-memory cap or unlimited-result responsiveness.
- Large structured consumers can lose fields at preview limits. A required presentation needs a typed bounded preview or resource reader, not an unbounded generic bypass.
- Latest-value ranges deliberately do not provide historical consistency across reads. Replacement invalidation and local request fences reset the view instead.
- Native mutable sources must report changed indexes accurately. Missing hints use full capture; completed display state never substitutes for the acceptance contract.
- Migration conflicts are resolved by regenerating the unshipped layer against its real base, preserving shipped migrations and populated rows. No startup rewrite or database deletion is required.
- The measured Electron fixtures use a production, unpackaged macOS build; they do not establish Windows/Linux, packaged-release, arbitrary-provider or indefinite leak acceptance. The separate real-Agent run succeeds; its completed durable result is restored and read on the final build without another model call.

## Verification

- AC1 — `AcceptedToolResults.test.ts` proves mutable-source detachment, same-call replacement and zero settled-output reserialization; `observation.test.ts` and native projection suites cover immutable acceptance/changed indexes. After the shared-snapshot refinement, the explicit Main command passes 247 tests in 5 files. Core runtime passes 15 tests, Claude 21, Pi 21 and Durable 8; exact commands and working directories are recorded in `native-test-evidence.md` from their owner’s tool transcript, not invented log files.
- AC2 — Database layer #23873 passes 284 tests in 12 explicit Main files, including populated migrate-forward, compact paging/full readers and cascade cleanup. Final `AgentSessionMessageService.test.ts` passes 89 tests after implementation-layer changes. Migration-chain validation passes.
- AC3 — `ToolResultService.test.ts`, `useToolResult.test.ts` and `MessageProjectionService.test.ts` cover replacement A/B, late completions, pending/reattach and owner/gap/baseline invalidation; final child cache-owner regression passes 5 tests. Electron `functional.json` confirms replacement invalidates the open range and resets pagination. Historical result reads are absent.
- AC4 — Renderer `MessageTools.test.tsx`, `MessageMcpTool.test.tsx` and `AgentToolRenderer.test.tsx` cover closed-card reads, disclosure and preserved execution state; affected UI/export command passes 282 tests across 12 files, with the changed UI rerun passing 69 across 4 files. Electron fixtures verify every open displays the tool's own current text.
- AC5 — `toolResultRead.test.ts`, handler tests and storage tests cover UTF-8 bounds, validated cursors, bounded SQLite reads and legacy blob chunks. Final API/acceptance command passes 70 tests in 3 files; child/range command passes 23 in 2. Electron records preview 8,388 serialized bytes, a 262,144-byte page with next cursor 524,288, and a rendered 32×32 resource image through CSP. The focused handler/range command passes 69 tests in 2 files, including Unicode-safe legacy entity pages retaining identities, inline values and labeled blob fields without full blob hydration.
- AC6 — `ToolResultService.test.ts` covers the 16 MiB serialized-byte LRU, oversized full non-retention, close/reopen fences and shared-owner release; child-owner regressions preserve parent/other consumers. Five final-build eight-conversation runs end at renderer heap 90.0 → 60.3 MiB after closing fixture tabs and GC. Main heap is 147.2 → 147.0 MiB, external 20.9 → 37.0 MiB, RSS 342.8 → 327.2 MiB; DOM Nodes are 3779 → 6035. New same-call 2 MiB replacements 5–20 keep renderer heap 62.8–62.9 MiB and Nodes at 6346, with no forced card reopens. These finite checks do not prove indefinite leak freedom or a total-memory cap.
- AC7 — The 12-file, 282-test renderer command covers specialized/citation/image cards, child panes and markdown export; database-layer full readers cover context, resume, fork and diagnostics. Electron verifies explicit full output of 16 MiB, image display and same-call replacement. A separate actual Agent run with `deepseek::deepseek-flash` completes in 6.820 s: exactly one `read` call reaches `output-available`, and the 972-character reply contains the required sentinel. This one provider/tool run does not cover every consumer or platform. The focused consumer command passes 41 tests in 6 files, including complete 64,024-character meta-tool copy and unavailable-read errors. A real Electron generic MCP card decodes a 218,558-byte deferred PNG through its owned URI at 1920×1200 natural size while retaining raw paging.
- AC8 — Main root/child/message projection tests, ThreadFeed/native package suites and renderer projection tests cover accepted stable parts, ordered patches, duplicate/gap recovery, replacement and persistence barriers. The explicit Thread/reattachment/catalog command passes 29 tests in 3 Main files; the post-prefix-fix child/range rerun passes 23 in 2; the child renderer owner regression passes 5. Final shared-snapshot Main tests pass 247 in 5 files. Node typecheck, scoped lint and production/utility builds pass after that refinement; prior web/type/docs gates remain applicable to unchanged surfaces. No full local suite was run.
- AC9 — Five alternating production-artifact runs per side perform twenty actual card expand-close cycles for each of 256 KiB, 2 MiB and 16 MiB settled results under 30 ms text updates. New per-run p95 ranges are 80.0–94.1, 78.5–93.6 and 80.0–88.5 ms; all meet 100 ms. No ≥50 ms renderer tasks occur in the final matrix or separate renderer traces. At 16 MiB, median Main CPU is 193.4 → 50.4 ms/s; the baseline crypto hash/serialization hotspots are absent from the final profile. The separate DeepSeek Agent completes one real read in 6.820 s; the final build restores its durable output. An intermediate build recorded an unattributed 55 ms task; its cause is not claimed fixed. The baseline already has defer; its Main/renderer artifacts are frozen while external native-runtime packages are shared and bypassed by fixtures. Body visibility includes old mounting/highlight delays; container p95 is about 14–16 ms on both sides.
- AC10 — Source audit removes the eager gate and output-revision keys and migrates internal reads to explicit purposes. The bilingual triplet moves to implemented only in this final layer; pairing, transition against the approved Spec head, changed-file formatting and documentation checks pass. The performance report separates deterministic fixtures, the real-Agent run, retained Main buffers, higher DOM counts and untested platforms.

Final fixture evidence is recorded in `.context/cherry-electron-dev/summary.json`, with `functional.json`, paired metrics/memory files and CPU/renderer traces. Superseded intermediate measurements are isolated under `pre-shared-snapshot/`. `build-metadata.json` records base `78d2cea7949868d669c8ceb26f1f3dad78555140`, executable source fingerprint `6ccb768b6f347a17bd06e439b776729ac7a579661934d6d170745c699f266058` and after-Main SHA-256 `5675f21813198fa8c549d4f656951191a9d30064df04bfcd7ad37213592d01fe`. The baseline already includes defer. Apple M5, 10 cores, 32 GiB, Electron 45.2.2; production plus utility-process, unpackaged, 960×600 viewport at device scale factor 2. Report renderer heap, DOM, Main heap/external and process RSS separately; the cache budget is not a total-memory limit. Detail-visible timing includes the old reader’s deferred mounting/highlighting behavior and is not a pure serialization benchmark.
