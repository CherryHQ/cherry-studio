# Agent Note: Screenshot translation overlay

Status: proposed

English | [中文](2026-11-11-screenshot-translate-overlay.zh.md)

## Problem

Screenshot captures cannot translate recognized text in place while preserving the chosen image output and capture-session ownership.

## Proposal

Translate individual OCR lines using conservative offline language estimates, a selected configured model, and fixed physical boxes. Keep uncertain, mixed-script, overlapping, or unfittable lines original. Approximate backgrounds with a flat sampled fill and fonts with fitted single-line text. The target preference is shared with Translate. Translation and annotations are mutually exclusive; export waits for active work and follows the selected view. Preserve the existing [capture-session ownership decision](../../implemented/bug-fix/2026-11-08-screenshot-result-session-ownership.md).

AC2 is a narrowed proposal: it does not establish full acceptance of the original issue's arbitrary language protection, faithful typography, paragraph reconstruction, or photographic background restoration.

## Alternatives considered

- LLM language detection and per-block source correction: deferred in favor of offline classification without extra provider calls.
- Paragraph reflow, exact typography, and background reconstruction: deferred because OCR provides line text and rectangles, not the necessary layout or image metadata.
- Exporting during active work: rejected to avoid publishing an incomplete snapshot.

## Acceptance criteria

- AC1 — A settled screenshot selection exposes Translate, starts recognition when needed with automatic OCR off, and explains unavailable or failed recognition. (verification: renderer and Electron; owner: implementation worker and delivery agent)
- AC2 — Eligible OCR lines receive bounded translated replacements at their original physical boxes; skipped lines and pixels outside replacement boxes remain original under the documented offline classification and flat-background limitations. (verification: unit, raster and Electron; owner: implementation worker and delivery agent)
- AC3 — Original/Translated comparison reuses completed results, and settled Copy, Save, confirm and chat output match the selected view without controls in the bitmap. (verification: renderer, raster and Electron; owner: implementation worker and delivery agent)
- AC4 — Screenshot translation uses the selected configured model, remembers explicit choices, defaults to a usable current chat default when appropriate, and never silently substitutes a model for an invalid explicit request. (verification: shared schema, main, renderer and Electron; owner: implementation worker and delivery agent)
- AC5 — Retrying one failed block preserves other successful blocks and ignores results from invalidated selections or pooled sessions. (verification: renderer, raster and Electron; owner: implementation worker and delivery agent)

## Risks

- Offline classification can be wrong and skips short or uncertain text.
- Flat backgrounds and fitted fonts are approximate; unsupported layouts can remain original.
- OCR availability varies by platform and installed fallback.
- Partial failures leave original lines in the output.
- Changing the shared target preference affects Translate as well.
- No prior human Approval has been obtained for this proposed Spec.
