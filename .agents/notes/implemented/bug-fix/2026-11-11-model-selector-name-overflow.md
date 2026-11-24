# Agent Note: Make a clipped model name readable in the model selector

Status: implemented

English | [中文](2026-11-11-model-selector-name-overflow.zh.md)

## Problem

A `ModelSelector` row clips the model name to a single `truncate` line and then competes with the `| <model id>` disambiguation suffix for the same space. The suffix uses `flex-[1_999_0%]`, so once the name fills the row it shrinks to zero width and is dropped by `overflow-hidden`; the name keeps whatever it needs and is clipped instead. Long upstream names — CherryIN ships `Deepseek: DeepSeek: DeepSeek V4.1 Flash (1017)`, with the vendor prefix repeated by its own API — therefore read as `Deepseek: DeepSeek: DeepSeek V4.1 Fla...` with no way to see the rest.

The only escape was the native `title` attribute, which is slow (about a second), unstyleable, and does not wrap; the detail card's own title was also `truncate`, so the one surface meant to show the full name clipped it too.

## Decision

Replace the row name's native `title` with the `@cherrystudio/ui` `Tooltip`, mounted only while the name actually overflows. Overflow is `scrollWidth > clientWidth + 1` measured from a ref plus a `ResizeObserver`, so a row whose name fits is unchanged: no tooltip, no extra wrapper behavior, no hover surface where there is nothing hidden.

The detail card title drops `truncate` for `break-words` and renders the full name wrapped inside its existing capped, scrollable content box.

The disambiguation suffix keeps its current flex behavior. Rebalancing the name and the suffix is a separate presentation decision; this fix only guarantees the full text is reachable.

## Alternatives considered

- Keep the native `title`: it does not wrap, cannot be styled, needs about a second, and the reported problem is precisely that the truncated text is unreadable.
- Always mount the tooltip: it repeats text that is already fully visible and adds a hover surface to every row for no benefit.
- Narrow the name and let the suffix keep a share of the row: both halves would then truncate and the row would lose characters it currently shows.
- Strip the duplicated vendor prefix from upstream names: a display policy for names the provider supplies, not a clipping bug; it needs its own rule for every provider.

## Consequences

A hovered row whose name overflows shows the complete name in a wrapping, width-capped tooltip after 300 ms; a row that fits keeps its previous behavior. The detail card title now occupies up to three lines instead of one, growing the card instead of hiding text. Names, model resolution, and selection are untouched.

## Verification

- Regression — `ModelSelector.test.tsx` renders a row whose name is longer than the row and asserts the row exposes that name through its tooltip: the case fails against the previous native `title` row and passes after the fix. The rest of the file and `ModelSelectorDetailCard.test.tsx` keep row rendering, selection, pinning, and detail-card content green.
- Regression — Electron run against a dev profile whose CherryIN name is longer than the row: an overflowing row reports `scrollWidth 497 > clientWidth 281` and opens a `delayed-open` tooltip 320 px wide wrapping the full name, while a fitting row reports `scrollWidth === clientWidth` and opens no tooltip.
- Regression — the same Electron run reads the detail card title as a 60 px three-line block with `scrollWidth === clientWidth`, so the card no longer clips the name.
