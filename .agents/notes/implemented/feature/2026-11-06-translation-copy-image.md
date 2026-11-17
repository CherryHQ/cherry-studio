# Agent Note: Copying translated output as an image

Status: implemented

English | [中文](2026-11-06-translation-copy-image.zh.md)

## Problem

The translation page copies text, but sharing its formatted result as an image requires a manual screenshot that can omit content below the viewport.

## Decision

`TranslateOutputPane` offers Copy as image beside its existing output actions. It captures only the completed translation body, including rendered Markdown and formulas when preview is enabled. Plain-text mode retains literal text. The body has the current semantic background and foreground; capture composites it over the themed `--card` backdrop so a translucent window background does not make the PNG translucent; the existing scroll viewport ref and scroll synchronization remain intact.

The action lazily uses `exportService.captureScrollableAsDataUrl` and `copyImageToClipboard`. This retains the shared capture queue, asset/font preparation, full scroll dimensions, and PNG clipboard conversion. The caller awaits the clipboard write before confirming success and reports capture or clipboard failures through the existing copy-failure toast.

Blank or streaming output cannot be copied as an image. A synchronous in-flight guard prevents repeated requests. A result revision invalidates an unfinished capture when the content, preview mode, or translation state changes, even if the previous text returns; unmounting also prevents a later clipboard write. A clipboard write already handed to the operating system cannot be canceled.

## Alternatives considered

- Capturing the whole pane includes unrelated controls and the character counter.
- A separate screenshot implementation duplicates the existing asset handling and capture serialization.
- Saving PNG files or adding image styling preferences expands a single clipboard action beyond its scope.

## Consequences

The feature adds no preference, persistence format, model request, dependency, or credential access. It shares the image export pipeline's dimension limit and rendering constraints. Exceeding that limit fails without a success notification. The action does not include the source pane, history, or output controls.

## Verification

- AC1 — `TranslateOutputPane.image.test.tsx`: the real output pane, export queue, Markdown renderer, and PNG clipboard utility capture full-height output without controls, preserve rendered Markdown/KaTeX, and disable blank or streaming results; only rasterization and the clipboard boundary are substituted. An isolated Electron development run through history reuse confirms complete PNGs for 100 synthetic paragraphs and a formula (8120 pixels high), alpha 255 in light/dark background pixels, and no action buttons in the body.
- AC2 — `TranslateOutputPane.image.test.tsx`: duplicate clicks, rejected writes with retry, rasterization failure, replaced/restarted results, and unmounts preserve clipboard and notification ownership.
- AC3 — Focused renderer suites for `TranslateOutputPane`, `TranslatePage`, `image`, and `ExportService` pass together; web TypeScript checking also passes.
