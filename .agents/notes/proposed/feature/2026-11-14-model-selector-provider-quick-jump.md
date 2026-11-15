# Agent Note: Model selector provider quick jump

Status: proposed

English | [中文](2026-11-14-model-selector-provider-quick-jump.zh.md)

## Problem

Long model lists make distant provider groups difficult to reach without changing search or selection.

## Proposal

Place a single horizontally scrollable, non-wrapping 32 px avatar strip above the desktop model list inside the existing popover body. Derive buttons from rendered provider headers in list order using their exact group keys, including composed groups. Show nothing when fewer than two provider headers remain. Reuse provider display names for button names and tooltips.

Activation scrolls the current header index with start alignment and the existing 36 px sticky-header padding, subject to scroll-range clamping. Highlight only that provider header with a steady accent background for 1600 ms after the latest activation. Keep keyboard focus bookkeeping independent. Cancel pending jumps and highlight timers on close, unmount, or target removal. Preserve search, selection, multi-select mode, popover state and active-descendant navigation.

Deduct the strip height from both the fallback and measured body budgets, clamp the list height to zero, then deduct the existing 8 px list padding once and clamp again. Keep the strip outside the virtual scroller. This note remains proposed; it does not record Spec approval or establish a repository workflow default.

## Alternatives considered

- Collapse each provider with remembered expansion: adds expansion state and changes browsing behavior beyond a quick jump.
- Filter-chip row instead of avatars: changes the visible inventory instead of retaining the full list.
- Shared shell slot: unnecessary for this local fixed-height strip; retain the shell API.
- Show a strip for one provider below many pinned rows: accepted narrowing excludes it; a single remaining provider group gets no strip.

## Acceptance criteria

- AC1 — Exactly one named button per rendered provider header appears in list order only with at least two headers; pinned groups add no button. (verification: renderer vitest)
- AC2 — A jump mounts the target header, lands at its start minus sticky padding with clamping, and highlights only that header. Native sticky overlap is visually checked. (verification: renderer vitest and Electron manual check)
- AC3 — Every activation restarts 1600 ms; previous timers cannot clear newer highlights; close, unmount and target removal clear timers and pending frames. (verification: renderer vitest)
- AC4 — Search, selection, multi-select mode, popover state and the mounted active descendant survive jumps. (verification: renderer vitest)
- AC5 — Buttons are Tab reachable and Enter/Space activates once; arrow, PageUp/PageDown and Enter list navigation retain their behavior. (verification: renderer vitest and Electron manual check)
- AC6 — With a measured height, strip and list fit the body and all heights clamp at zero. Before measurement, the list uses an estimate capped at 440 px and can be clipped until the observer corrects it. At body heights of 32–39 px, list padding can be clipped. Below 32 px, the strip itself is clipped and its buttons may remain in the tab order. Narrow widths and tiny heights are visually checked. (verification: renderer vitest and Electron manual check)

## Risks

Horizontal strip reachability needs checking at narrow widths. Highlight visibility must remain clear under `prefers-reduced-motion`; the proposed steady tint requires no animation. The fixed-height assumption becomes invalid if the strip ever wraps. With a measured height, strip and list fit the body and all heights clamp at zero. Before measurement, the list uses an estimate capped at 440 px and can be clipped until the observer corrects it. At body heights of 32–39 px, list padding can be clipped. Below 32 px, the strip itself is clipped and its buttons may remain in the tab order. jsdom geometry cannot establish native sticky compositing, theme contrast or physical clipping.
