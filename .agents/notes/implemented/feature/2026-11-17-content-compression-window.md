# Agent Note: Content Compression Window

Status: implemented

English | [中文](2026-11-17-content-compression-window.zh.md)

## Problem

A finite `maxMessages` historically keeps a raw message-count window and skips turn-start durable compaction. Users must either send older rounds verbatim or lose them. Issue #19711 asks for a bounded middle tier without changing the existing behavior when the new mode is off.

## Decision

Persistent Chat has an optional global `chat.context_settings.compress_window` and per-assistant `contextSettings.compressWindow`. The global default is `null` (off). An absent assistant value inherits the global setting; explicit `null` disables it; a number selects a custom window.

For positive integer A = `maxMessages` and integer B = `compressWindow` greater than A, each user row starts a round, including assistant continuations until the next user row. The current user row counts as the newest round. The latest A rounds stay verbatim, rounds A+1 through B form one summary, and older rounds and their `read_file` / `fs_read` capabilities are excluded. Short histories need no summary.

`PersistentChatContextProvider` uses the existing summarizer and the resolved compression model. It bounds input and output against the compressor's declared window, falling back to the smallest declared request-model window. Summaries are recomputed per request, never cached or persisted. Source rows and existing durable markers are not changed; old markers are not reused because they may include excluded content. File and stored-output manifests identify summarized attachments.

Missing or disabled compression, unknown or insufficient input room, empty output, and thrown errors log a warning and serve only the latest A rounds without a successful summary block. Disabled or invalid window configurations retain the legacy message-count behavior.

General Settings exposes the window switch and total-round input outside the overflow-policy master switch. Enabling starts with a valid window above A; the UI rejects a missing A or B not greater than A. Editing A cannot invalidate an enabled B. Invalid numeric edits remain visible with an error and do not reach persistence. The assistant editor offers Custom, Off, and Follow global independently of its overflow override. The UI names the recent limit as rounds while the window is active and explains the extra per-request model cost and recent-only fallback.

## Alternatives considered

- Tuning only the budget trigger cannot express a bounded middle round range.
- Local rule-based extraction is cheaper but does not provide the selected model-generated summary.
- Tool-output truncation does not bound conversation rounds.
- Keeping a competing hard message-count cap makes the compressed zone ambiguous; B owns the round window instead.
- Reusing durable summaries can reintroduce content older than B; uncached summaries avoid stale results after branch changes.

## Consequences

Summarizing the middle on every request adds latency and model cost. Summaries are lossy, and the summarizer may itself overflow. Existing summarizer budgets and overflow handling remain its owner; `proposed/bug-fix/2026-11-13-chat-context-overflow.md` records that separate decision. The mode stays off by default. The backend and Settings layers can be reviewed separately, without treating the backend alone as the completed feature.

## Verification

- AC1 — `compressionWindow.test.ts` and `PersistentChatContextProvider.compaction.test.ts`: user-led round boundaries, verbatim recent rows, bounded middle summaries and exclusion of older rows.
- AC2 — `ContextManagementSettings.test.tsx`, `compressionWindow.test.ts` and request/context resolution tests: invalid bounds do not persist, changing or clearing A cannot invalidate B, and absent/invalid request configuration keeps legacy behavior.
- AC3 — `PersistentChatContextProvider.compaction.test.ts`: unavailable/disabled compression, insufficient or unknown input room, empty summaries and thrown failures return recent rounds only without a success marker.
- AC4 — `PersistentChatContextProvider.compaction.test.ts`: excluded file and stored-output capabilities are revoked, while the live and summarized window remains accessible and nameable.
- AC5 — `compressionWindow.sqlite.test.ts`: real production-migration SQLite history, including existing durable markers, stays byte-for-byte unchanged on summary success and failure.
- AC6 — `ContextManagementSettings.test.tsx` and `EditDialogs.test.tsx`: real controls, explicit validation and the debounced Custom/Off/Follow-global PATCH boundary; English/light and Chinese/dark narrow browser previews were inspected.

Final scoped runs cover 411 passing tests in 21 explicit files (229 main, 11 shared, 171 renderer). Previews use persistence/theme/provider fixtures, not a native Electron session. No live or paid model call, full-project local typecheck, or full-project local lint was run; broader CI and native/provider acceptance remain separate review boundaries.
