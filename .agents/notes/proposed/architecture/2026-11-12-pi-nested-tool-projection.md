# Agent Note: Pi nested tool projection and retained evidence

Status: proposed

English | [中文](2026-11-12-pi-nested-tool-projection.zh.md)

## Problem

Codemode executes nested tools through native permission and execution pipelines, but Cherry does not project those calls as ordinary tool parts. Pi forwards only updates for already-known model calls. Durable consumes `live.tools`, not `live.nestedTools`. The missing information affects shell and file tools as well as MCP artifact declarations.

Native 1.5.2 also has a persistence gap. Pi retains bounded nested names, arguments and status, but not tool results or explicit parent edges. Durable has complete live arguments and task-scoped results, but retires nested slots and caller documents; its codemode details retain only a 200-character argument preview. Parsing these previews cannot reconstruct authoritative arguments or results.

PR #24318 restores ordinary Pi artifact declarations from successful native records. This proposal generalizes that repair and must retain its server-origin checks and deduplication. PR #24317 already supplies native shell deadlines for both runtimes; timeout policy is outside this proposal.

## Proposal

Native execution owns the record. Extend the existing Pi nested recorder and Durable terminal commit path, through the repository dependency patches, to retain a versioned presentation record on the outer tool result. Retain native call ID, immediate parent call ID, resolved tool name, executed arguments, terminal outcome and the bounded tool result needed by existing renderers. Durable must capture descendants before their task documents retire, in the same native commit that publishes their terminal evidence; reconstructing records from a coalesced UI observer is insufficient. Do not add a second execution journal, scheduler or Cherry database table.

Keep records outside model text and codemode program values. Native permission checks, argument repair, tool execution and replay remain authoritative. Record the arguments that actually execute after repair and permission handling; never use a preview as the executed input. Stable native IDs, scoped to the owning conversation and outer call, distinguish equal concurrent calls and survive reopen. Parent edges preserve recursive calls without parsing IDs.

Use explicit bounds: at most 256 retained calls per outer call, 8 KiB of arguments per call and 32 KiB of arguments total, matching Pi's current argument budget; add at most 64 KiB of result JSON per call and 1 MiB of result JSON total. Measure UTF-8 serialized bytes. Omit an entire over-budget field with a typed omission reason and original byte count; never store sliced JSON. Retain terminal status independently of omitted payloads. Native spill references already returned by tools remain references; do not duplicate file contents or inline binary data beyond this budget. Report omitted calls explicitly. These records use the native session's existing storage and deletion lifecycle.

Both runtime adapters project live nested starts, updates and terminal results into `dynamic-tool` parts on the owning assistant message, using the same identity and metadata as archive projection. Keep outer codemode output independently visible. A completed nested success remains successful even when a later script statement fails. Cancellation and interrupted calls must not become success or remain indefinitely running. Archive reconstruction consumes the retained native record; it does not rely on having observed the execution.

Main applies the existing tool-name/MCP-origin mapping to these parts. Existing renderer components handle shell, files and supported MCP tools; unknown tools use the generic renderer. Preserve parent identity in provider metadata. Do not synthesize successful results from arguments alone. Artifact declarations require a successful built-in `cherry-tools` call and complete schema-valid arguments, and appear once. Replace the artifact-only synthesis from #24318 when generic parts are available, retaining legacy record support without duplicates.

Old records remain readable. Render only evidence actually available: mark omitted payloads or incomplete legacy records explicitly, and never replay a tool to fill history. No data backfill is promised for information the old runtime never saved.

Implementation follows approval in dependent layers: native retention and runtime projection first, desktop mapping and renderer behavior second. Reconcile #24318 against its live merge state before implementation. Move this note to implemented only after every acceptance criterion has evidence.

## Alternatives considered

- Parse codemode text or the 200-character Durable argument preview: loses types and cannot distinguish truncated arguments from executed arguments.
- Capture nested calls in Main observers: misses fast calls, late attachment and crash recovery, and makes persistence depend on UI timing.
- Add only live nested projection: cards disappear on completion or reopen.
- Add a renderer special case for each tool: repeats the missing contract and cannot restore absent native history.
- Persist unlimited raw nested output: duplicates large payloads and removes native storage bounds.

## Acceptance criteria

- AC1 — In both runtimes, real codemode calls to shell, file read/write and MCP tools expose distinct stable nested identities, executed arguments, progress and terminal outcomes; parallel equal calls and recursive calls remain distinguishable (verification: native runtime integration tests)
- AC2 — Native archive, fresh runtime reopen and recovery after interruption preserve retained nested evidence without re-executing completed tools; outer script failure does not erase an earlier nested success (verification: file-backed native runtime integration tests)
- AC3 — Successful built-in artifact declarations with arguments longer than 200 characters produce one artifact card before and after reopen; failed, cancelled, foreign-server and incomplete declarations produce none (verification: desktop integration and renderer tests)
- AC4 — Budget boundaries, omitted fields, missing legacy evidence, failures and cancellations remain truthful and bounded; model-facing output and native permission behavior remain unchanged (verification: native runtime and desktop contract tests)
- AC5 — In a PID/cwd/CDP-verified Electron instance, run both runtime variants through the composer, observe nested shell/file/MCP cards during execution and after completion, close and reopen each conversation, and verify artifacts open the expected generated file without duplicate cards or renderer errors (verification: Electron end-to-end)

## Risks

Native retention must capture descendants before retirement, including cancellation and recovery paths. Extending only the happy-path codemode wrapper leaves a data-loss race. Native patch changes need source and generated distribution consistency and focused tests against the actual patched dependency.

Results and arguments may contain sensitive tool data already visible in direct calls. Use the existing session storage boundary and output limits; do not copy them into diagnostic logs. The explicit limits mean unusually large artifact declarations may be unavailable after reopen; present that omission truthfully.

The Electron evidence must name the tested head, PID, cwd, CDP target, runtime, scenario and persisted session. Deterministic model responses may drive real native tools for repeatability, but injecting already-projected messages is not end-to-end evidence. macOS acceptance does not establish Windows PowerShell acceptance.
