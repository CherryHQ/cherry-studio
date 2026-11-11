# Agent Note: Display operated apps through a client-only channel

Status: implemented

English | [中文](2026-11-10-computer-use-app-icons.zh.md)

## Problem

The client needs to identify the applications operated by an Automation REPL call. Icons are application presentation data, not tool results or session history. Inferring a target from the foreground application or JavaScript text can label the wrong app.

## Decision

Record actual resolved targets during Computer Use host dispatch, outside the guest result. Associate them with the existing per-call REPL cell ID in a bounded, process-local cache of 256 calls. Deduplicate targets within each call. The renderer reads the cell ID already present in REPL context and queries the call's app list through IPC; it does not read app metadata from tool output.

The card displays every app used by that call. Session details use the same icon component and cache; the live control projection carries only the stable application identity. SWR deduplicates lazy icon queries by stable application identity. A standalone SDK client queries `getAppIcon({ identity })` and closes after the read. Validate PNG MIME type and bounded base64 before returning the image to the renderer. Missing identities, unavailable icons and failed image loading retain the accessible app-name fallback.

No Pi dependency patch, Claude result projection change, MCP `_meta`, or icon-bearing `ToolResult` is needed. Both runtimes use the existing Automation REPL card and cell-context transport. Pi projections preserve the native structured result, and the MCP card unwraps the original result on both success and failure, retaining the cell context and audience annotations in live and restored history.

## Alternatives considered

- Tool-result or session metadata duplicates UI-only data in execution and history contracts.
- Foreground state and source-code parsing do not prove the application's actual identity.
- A single icon for a multi-app cell hides other operated applications.

## Consequences

The association cache is transient. Evicted calls and calls from an earlier application process show no inferred icon. Calls without Computer Use targets have no app icons. This change does not persist icons or update model-visible output. Icons appear once the call returns its cell context.

The pinned SDK and matching native packages are published version 0.1.11, which provides the independent API. No local SDK path is committed. macOS, Windows and Linux supply native icons. Windows reads executable/AppsFolder icons; Linux uses GTK 3/GdkPixbuf for desktop-entry icons, including SVG and themes. Missing icons or native libraries use the named fallback. External third-party Computer Use MCP servers are outside this built-in REPL integration.

## Verification

- AC1 — real REPL kernel and Computer Use service tests retain the resolved target separately, deduplicate repeated operations and keep pure-JavaScript cells unassociated.
- AC2 — renderer tests display multiple targets, share icon reads between calls and remove stale targets when the cell changes; schema checks reject non-PNG icon data.
- AC3 — client icon reads leave app control empty; the upstream SDK/native tests verify independent request validation and icon generation.
- Electron component acceptance on macOS loads real 64×64 Finder PNGs in both session details and the tool card through IPC and the published SDK, shares icon queries, and retains the unknown-app fallback. Target associations are fixtures; live-model Pi/Claude and Windows/Linux visual acceptance remain untested.

- Review regression: the real Pi MCP converter, native session, live/history projection, tool-card adapter and REPL parser retain cell context for successful and failed calls.
