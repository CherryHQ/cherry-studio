# Agent Note: Avoid scaling dialog content during entrance

Status: implemented

English | [中文](2026-10-24-dialog-entrance-raster.zh.md)

## Problem

Opening a dialog with a long emoji list, such as the 50-row assistant picker, dropped most frames during the 260 ms entrance. On a packaged 2.1.7 build at device scale factor 1.5, a CDP trace recorded 56–61 dropped frames and 241.6 ms of raster work. The main thread stayed mostly idle at about 12 ms of script, so the cost was compositor rasterization.

The 1% `zoom-in-99` scale changes the raster scale of the dialog layer every frame. Each picker row renders two color-emoji glyphs, the foreground plus the scaled `EmojiIcon` background, so every raster pass was expensive.

## Decision

Remove `zoom-in-99` and `zoom-out-99` from the shared `DialogContent` motion. Entering and leaving keep the 260/200 ms fade and the 16 px directional slide. The `fade-scale` variant now fades without scaling; its name stays for API compatibility.

The shared primitive owns the fix because the scale was the trigger for every dialog, not only the assistant picker. With a stable layer scale, the same content rasterizes once.

## Alternatives considered

- Add `will-change: transform` to `DialogContent`: measured the same result at 9 dropped frames, but keeps a composited layer for every open dialog and can switch text to grayscale antialiasing. Rejected as the default.
- Remove the duplicated blurred emoji background in picker rows: measured the same result, but changes the icon design and leaves the scale trigger in place for other emoji-heavy dialogs.
- Keep the scale for large dialogs only: requires per-dialog content knowledge in a primitive that has none.

## Consequences

Dialog motion loses a 1% zoom that users cannot perceive; fade and directional slide remain. Any future scale animation on dialog content must account for full-layer raster invalidation, especially with color-emoji content.

## Verification

- Regression — `pnpm exec vitest run packages/ui/src/components/primitives/__tests__/dialog.test.tsx packages/ui/src/components/composites/confirm-dialog/__tests__/confirm-dialog.test.tsx`: 22 tests pass and assert that `zoom-in-99`/`zoom-out-99` stay absent while fade and slide remain.
- Regression — CDP trace of the assistant picker on the packaged 2.1.7 build: pinning `--tw-enter-scale` and `--tw-exit-scale` to `1` reduced dropped frames from 56–61 to 9 and raster work from 241.6 ms to 2.5 ms.
- Regression — `oxfmt --check`, `oxlint --deny-warnings`, and `eslint` on the three changed files: all pass.
