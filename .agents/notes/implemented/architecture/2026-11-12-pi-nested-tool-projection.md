# Agent Note: Pi nested tool projection and retained evidence

Status: implemented

English | [中文](2026-11-12-pi-nested-tool-projection.zh.md)

## Problem

Codemode executes nested tools through native permission and execution pipelines, but Cherry does not project those calls as ordinary tool parts. Pi forwards only updates for already-known model calls. Durable consumes `live.tools`, not `live.nestedTools`. The missing information affects shell and file tools as well as MCP artifact declarations.

Native 1.5.2 also has a persistence gap. Pi retains bounded nested names, arguments and status, but not tool results or explicit parent edges. Durable has complete live arguments and task-scoped results, but retires nested slots and caller documents; its codemode details retain only a 200-character argument preview. Parsing these previews cannot reconstruct authoritative arguments or results.

PR #24318 restores ordinary Pi artifact declarations from successful native records. This implementation generalizes that repair and must retain its server-origin checks and deduplication. PR #24317 already supplies native shell deadlines for both runtimes; timeout policy is outside this change.

## Decision

Native execution owns the record. Extend the existing Pi nested recorder and Durable terminal commit path, through the repository dependency patches, to retain a versioned presentation record on the outer tool result. Retain native call ID, immediate parent call ID, resolved tool name, executed arguments, terminal outcome and the bounded tool result needed by existing renderers. Durable must capture descendants before their task documents retire, in the same native commit that publishes their terminal evidence; reconstructing records from a coalesced UI observer is insufficient. Do not add a second execution journal, scheduler or Cherry database table.

Keep records outside model text and codemode program values. Native permission checks, argument repair, tool execution and replay remain authoritative. Record the arguments that actually execute after repair and permission handling; never use a preview as the executed input. Stable native IDs, scoped to the owning conversation and outer call, distinguish equal concurrent calls and survive reopen. Parent edges preserve recursive calls without parsing IDs.

Use explicit bounds: at most 256 retained calls per outer call, 8 KiB of arguments per call and 32 KiB of arguments total, matching Pi's current argument budget; add at most 64 KiB of result JSON per call and 1 MiB of result JSON total. Measure UTF-8 serialized bytes. Omit an entire over-budget field with a typed omission reason and original byte count; never store sliced JSON. Retain terminal status independently of omitted payloads. Native spill references already returned by tools remain references; do not duplicate file contents or inline binary data beyond this budget. Report omitted calls explicitly. These records use the native session's existing storage and deletion lifecycle.

Both runtime adapters project live nested starts, updates and terminal results into `dynamic-tool` parts on the owning assistant message, using the same identity and metadata as archive projection. Keep outer codemode output independently visible. A completed nested success remains successful even when a later script statement fails. Cancellation and interrupted calls must not become success or remain indefinitely running. Archive reconstruction consumes the retained native record; it does not rely on having observed the execution.

Main applies the existing tool-name/MCP-origin mapping to these parts. Existing renderer components handle shell, files and supported MCP tools; unknown tools use the generic renderer. Preserve parent identity in provider metadata. Do not synthesize successful results from arguments alone. Artifact declarations require a successful built-in `cherry-tools` call and complete schema-valid arguments, and appear once. Replace the artifact-only synthesis from #24318 when generic parts are available, retaining legacy record support without duplicates.

Old records remain readable. Render only evidence actually available: mark omitted payloads or incomplete legacy records explicitly, and never replay a tool to fill history. No data backfill is promised for information the old runtime never saved.

The user explicitly requested implementation in the existing Spec PR without waiting for separate approval. PR #24317 is merged; #24318 remains open and its artifact-only synthesis is superseded by these generic parts.

## Alternatives considered

- Parse codemode text or the 200-character Durable argument preview: loses types and cannot distinguish truncated arguments from executed arguments.
- Capture nested calls in Main observers: misses fast calls, late attachment and crash recovery, and makes persistence depend on UI timing.
- Add only live nested projection: cards disappear on completion or reopen.
- Add a renderer special case for each tool: repeats the missing contract and cannot restore absent native history.
- Persist unlimited raw nested output: duplicates large payloads and removes native storage bounds.

## Consequences

Native patches own presentation evidence alongside their existing execution state. No Cherry database table, second journal or replay path is added. The published dependencies contain distribution files only, so patches update those files and their declarations. Records may omit large payloads; old sessions cannot recover evidence never saved. macOS Electron acceptance does not establish Windows PowerShell acceptance.

## Verification

- AC1 — Pi `tests/runtime.test.ts` and Durable `tests/runtime.test.ts` exercise real nested execution with concurrent equal calls, repaired arguments longer than 200 characters, distinct IDs and recursive parent edges. Electron runs real QuickJS codemode with write, read, bash and built-in MCP artifact tools.
- AC2 — File-backed native reopen tests preserve results after outer failure. Durable's shutdown/recovery test stops an outer call after its child completes, resumes from SQLite and asserts the child executed once with its result intact.
- AC3 — Renderer artifact tests reject pending, failed, cancelled and foreign-server declarations. Both Electron variants show exactly one artifact card with long arguments after completion and conversation reload; previews load the generated HTML.
- AC4 — `tests/nestedEvidence.test.ts` covers whole-field UTF-8 budget omission, aggregate limits, omitted-call counts and absent legacy results. Runtime tests cover errors and cancellation. Existing native-tool and connection tests verify affected host contracts; retained records are separate from model content.
- AC5 — Electron PID 43177, current checkout, CDP 9267, target `http://localhost:5176/windows/main/index.html`: deterministic OpenAI responses drive real native tools from the composer. Both runtimes display shell output before completion, final output, one artifact after reload and the expected HTML in the native preview, with no renderer page errors. Evidence lives in `.context/cherry-electron-dev/nested-e2e-result.json` and `nested-preview-result.json`; sessions are `c4cbb676-fced-4e0f-aa5f-a15c91a3f03f` (Pi) and `7644e83e-5a6a-4a85-a112-cdfa58a90dd2` (Durable). The instance uses an isolated profile and the implementation working tree on Spec head `26b1df8a72bbd4fb765c8ec9087cb7508c73e0fb`.
