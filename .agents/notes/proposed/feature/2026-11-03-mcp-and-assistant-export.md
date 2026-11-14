# Agent Note: MCP JSON and batch assistant export

Status: proposed

English | [中文](2026-11-03-mcp-and-assistant-export.zh.md)

## Problem

Users can import MCP configuration and assistant preset arrays, but cannot export MCP configuration or select multiple assistants for one export. Name-keyed MCP files can silently lose duplicate or unsupported keys. The assistant catalog's first page is not a complete export source.

## Proposal

Add renderer-only export actions using existing reads and native file saving. MCP export uses the complete list, excludes built-in and in-memory servers, explicitly projects importable configuration, preserves credentials and local package paths, normalizes missing transport types, and validates both schema and cardinality. Duplicate eligible names and `__proto__` refuse the entire export before Save.

Batch assistant export loads fresh pages until the complete non-trashed list is available. A dialog defaults all IDs to selected, keeps hidden selections during independent search, and supports selecting or deselecting the entire list. Resolve groups successfully and fetch ordered prompts only for selected assistants; any unresolved group or read failure prevents saving. Save selected records in fetched order as one legacy preset array, with a UTF-8 size limit of 5,242,880 bytes. Cancellation and failure retain selection; only a returned path closes the dialog and announces success. Opening epochs prevent stale reads or saves from changing a later opening.

The note stays `proposed`; this PR does not claim an Approval on a Spec head.

## Alternatives considered

- Renaming duplicate MCP names, exporting a subset, or changing import semantics would change identity or conceal data loss.
- Redacting credentials or bundling package files would introduce a different transfer contract.
- Reusing the catalog page would omit assistants beyond 500 and inherit unrelated filters.
- Changing single export or import would broaden compatibility work beyond these two actions.

## Acceptance criteria

- AC1 — Eligible mixed-transport MCP configuration validates with unchanged server count through the existing import schema, preserving names, URL aliases and local package paths (verification: unit)
- AC2 — Duplicate eligible names and `__proto__` refuse the entire MCP export before saving, while case-distinct names and `constructor` survive (verification: unit)
- AC3 — Stored MCP credentials and defined false, zero, empty string and empty collection values survive export unchanged (verification: unit)
- AC4 — Built-in and in-memory servers are excluded before collision checks, and catalog search cannot narrow the MCP backup (verification: renderer)
- AC5 — Assistant selection includes every successfully fetched page beyond 500, independent of catalog filters, without accepting stale completion from an earlier opening (verification: renderer)
- AC6 — Selected assistants produce one flat legacy array in fetched order with resolved groups and prompts in API order; group or prompt failure saves nothing (verification: renderer)
- AC7 — Default-all, ID-based selection, whole-list select/deselect, hidden search selections, cancellation and retry remain observable in the dialog (verification: renderer)
- AC8 — An export over 5,242,880 UTF-8 bytes is refused before Save, while equality is allowed (verification: renderer)
- AC9 — Existing single export and assistant and MCP import paths retain their current contracts (verification: renderer)
- AC10 — All seven new strings have real translations in all fifteen renderer locales and the bilingual guides describe the actions and limitations (verification: docs gate)
- AC11 — Native Save, cancellation, import persistence and keyboard use work in the prepared Electron instance (verification: Electron)

## Risks

Files contain credentials and must be shared carefully. Package paths do not transport binaries or files. Existing assistant import rejects empty prompts; export does not invent content or promise universal round-trip. Concurrent reads are not an atomic snapshot. Native dialogs, destination dependencies and Windows behavior require runtime measurement. No main-process, IPC, DataApi, schema or migration changes are proposed.
