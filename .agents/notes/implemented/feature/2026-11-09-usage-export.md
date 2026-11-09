# Agent Note: Usage statistics export (PNG and XLSX)

Status: implemented

English | [中文](2026-11-09-usage-export.zh.md)

## Problem

Settings > Usage required manual screenshots for sharing and manual transcription of entries. It had no editable structured usage report.

## Decision

One Export menu at the top of Settings > Usage offers PNG and XLSX. PNG captures the current page content, including the already rendered entries and a displayed/total count; it does not fetch additional entries. Capture-only text includes the reporting range and time zone. Usage-scoped capture styles reveal scrollable content and hide export and pagination actions.

XLSX uses the existing `@e965/xlsx` writer. It reads all matching entries serially at 200 per page, validates totals, unique IDs and cursors, and refuses to pass partial results to saving. The fixed `Usage` sheet contains 32 scalar columns; `Metadata` contains 11 ordered rows describing the report conditions, view, sorting, query, final count and number policy. Unknown values remain blank, zero stays numeric, integers over 15 digits are text, and costs retain their original currencies without conversion.

Each operation freezes the existing time range, query, locale, translations, provider names and display settings when selected. The page reads the existing persisted entry sort keys without moving the entry query out of its section. An in-flight guard prevents duplicate operations; revision and mounted checks prevent stale or unmounted work from opening a later save dialog or issuing a toast. PNG requires current aggregate and entry data and waits at most 1500 ms for the chart's lazy fallback. The chart runtime uses `ImageCaptureEvent` to prepare the current option after `finished`, with a bounded 3000 ms wait and invalidation on option/size changes and unmount.

## Alternatives considered

- ExcelJS can write XLSX, but adding another writer is unnecessary because the root project already has `@e965/xlsx` and a binary save pattern; file-preview's separate dependency is not a reason to introduce it here.
- Handwritten OOXML with jszip would duplicate a maintained writer and add XML escaping, relationships, cell types and package compatibility responsibilities.
- CSV does not satisfy editable XLSX delivery, two worksheets or explicit cell types.
- Capturing only overview and heatmap omits the existing distribution chart and rendered entries from the current page.
- `exportTableToExcel` accepts strings, builds one worksheet and owns its filename and save operation. Reusing it would lose raw numeric types and the separate Metadata sheet or require an unrelated shared API change.

## Consequences

The frozen object is a query, not a database transaction snapshot. Total/ID/cursor checks and received data-change notifications detect some concurrent changes but cannot guarantee a point-in-time result. Changing view controls or the heatmap metric invalidates pending work, even if the original values are restored.

Saving uses the existing non-atomic IPC contract. PNG's `false` cannot distinguish cancellation from a save failure, so it produces a neutral unsaved message; XLSX's `null` cancellation is silent. Once a save operation has been handed to IPC, it cannot be revoked.

The complete XLSX is built in renderer memory. Its format limit is 1,048,575 data rows; no capacity stress test establishes a practical memory limit. Large reports require many serial requests, each subject to the existing GET recovery budget. No extra retry or hidden truncation is added.

## Verification

- AC1 — The real menu triggers PNG capture with the usage root and an extension-free save stem; successful saving, neutral false, rejected saving, busy deduplication, unready aggregates/entries, changed-and-restored periods and unmount are covered by appended renderer tests.（verification: renderer）
- AC2 — A real `@e965/xlsx` reader reads the exact bytes sent to save: all 201 IDs span two pages, zero cost is numeric, both sheet names and 11 metadata rows are preserved, and effective currency and the rendered chart fallback match the frozen conditions.（verification: renderer）
- AC3 — `usageExport.test.ts` passes all 26 cases, including workbook read-back, numeric/null/string handling, pagination counterexamples and file naming; the page test also rejects saving after the second page fails and silently ends cancelled XLSX saves.（verification: unit）
- AC4 — `Echarts.test.tsx` passes all 13 cases using real ECharts and `@napi-rs/canvas`, covering preparation completion, invalidation and bounded failure; these tests do not establish Electron screenshot pixels.（verification: unit）
- AC5 — The six specified renderer test files pass 73/73 cases, and the i18n gate validates 102746 translations across the catalog families; all 15 renderer locales add 51 translated keys each.（verification: renderer）
- AC6 — A built Electron app captured the real Usage page into a PNG containing the range and time zone, metric cards, heatmap, non-empty distribution chart, the TPS column and `Displayed entries: 25 of 120`, with the export and load-more controls hidden; the same run produced an XLSX that a real `@e965/xlsx` reader read back as `Usage` + `Metadata` with 32 headers, 120 records and 11 metadata rows. The native save dialogs were replaced by a probe handler returning the exact payloads; narrow/wide and light/dark screenshots, real disk writing and external spreadsheet editing remain unverified.（verification: Electron）
