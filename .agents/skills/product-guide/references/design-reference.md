# Guide Design Reference

Values come from the reference implementation (the Cherry Cloud plan activation guide), reached after several rounds of human review. Keep the type, color, width, and spacing values unless a human agrees otherwise. Placement values (side, offsets, cutout radius) describe a target near the top of the window; adapt them to the target as the skill's placement rule says.

## Spotlight coachmark (anchored guide)

| Part | Value |
|---|---|
| Dim | `fixed z-[79] shadow-[0_0_0_9999px_rgb(0_0_0/0.5)]`, radius = target radius + padding (the reference uses `rounded-[10px]` around the header's `rounded-md` ghost button; use `rounded-full` for round targets), portaled to `document.body`, `pointer-events-none`, `fade-in-0 animate-in duration-300 motion-reduce:animate-none` |
| Cutout padding | 4px around the target's `getBoundingClientRect()`, tracked with a `ResizeObserver` and window `resize` |
| Card | `Popover` + `PopoverAnchor virtualRef`, `side="bottom" align="start" sideOffset={12}`, `alignOffset={-4}` so the card's left edge lines up with the cutout, not the bare target |
| Card width | `w-76` (304px) |
| Card padding | `px-3.5 pt-2.5 pb-3`, `gap-0.5` between title and description |
| Title | `text-sm font-semibold leading-5` |
| Description | `text-xs leading-5 text-muted-foreground`, at most two lines |
| Footer | `mt-1.5`, an optional `text-xs text-muted-foreground` note on the left, one `Button variant="emphasis" size="sm"` on the right |
| Optional preview | A `bg-muted` header strip with a `bg-popover` card (`ring-1 ring-border shadow-md`) of up to 3 `h-6 text-xs` rows; the selected row uses `bg-accent` plus a 2px `bg-primary` indicator |

Structure, simplified from the reference guide:

```tsx
const PADDING = 4
// rect: target.getBoundingClientRect(), re-measured by a ResizeObserver and window resize
createPortal(
  <div
    aria-hidden
    className="pointer-events-none fixed z-[79] rounded-[10px] shadow-[0_0_0_9999px_rgb(0_0_0/0.5)] fade-in-0 animate-in duration-300 motion-reduce:animate-none"
    style={{ left: rect.left - PADDING, top: rect.top - PADDING, width: rect.width + PADDING * 2, height: rect.height + PADDING * 2 }}
  />,
  document.body
)
<Popover open onOpenChange={(open) => !open && dismiss()}>
  <PopoverAnchor virtualRef={{ current: { getBoundingClientRect: () => rect } }} />
  <PopoverContent side="bottom" align="start" alignOffset={-PADDING} sideOffset={12} className="w-76 overflow-hidden rounded-xl p-0">
    {/* optional preview strip, then title, description, footer */}
  </PopoverContent>
</Popover>
```

For a target near the bottom of the window use `side="top"`. For a round target use `rounded-full` on the dim layer.

## Decision dialog (feature-owned)

| Part | Value |
|---|---|
| Container | `DialogContent size="sm"` with `sm:max-w-[340px] gap-0 overflow-hidden p-0` |
| Header illustration | `h-20` (80px), separated by `border-b border-border` |
| Body | `px-5 pt-3.5 pb-4 gap-3` |
| Title / description | `text-sm font-semibold leading-5` / `text-xs leading-5` |
| Option list | `rounded-lg bg-accent p-1`, rows `h-8 text-xs` with an 18px avatar; selected row `bg-background shadow-xs` plus a check icon; at most 3 rows, the rest summarized as "N more" |
| Footer | an optional checkbox label (`text-xs text-muted-foreground`, one line) and one `emphasis size="sm"` button |

Measured result with three models: about 340×332 CSS px for the dialog and about 304×212 for the guide.

## Illustration rules

- Draw interface structure only: placeholder bars, dots, a selected row with a check. No logos, model or provider icons, plan or tier names, or real model names; plans and models change, and plans target users who must not see each other's names.
- Use only tokens: ground `bg-muted` over `bg-card`, cards `bg-popover` with `ring-1 ring-border`, selection `bg-accent`, a `bg-primary` indicator as the only accent, and `bg-border-strong` / `bg-accent` placeholders. Never add `dark:` palette overrides.
- Keep the ground distinct from the card in both themes, and separate it from the content with a border. A dark illustration on a dark dialog disappears.
- Scale the drawing as a whole (`origin-bottom scale-*`) to fit the header height; never squash one part.
- Decoration is limited to a masked dot grid and at most two sparkles; no gradients or color.
- Motion is limited to one entrance (`fade-in-0 slide-in-from-bottom-3`) with `motion-reduce:animate-none`.

## Visual checklist (Electron, light and dark)

- [ ] The target and its surroundings match the current real UI; the target component is unchanged.
- [ ] Exactly one spotlight, one card, and one primary action.
- [ ] Card left edge equals cutout left edge (measure; see below).
- [ ] Only 12px body and 14px semibold title text.
- [ ] Width matches the reference (304px guide, 340px dialog) and height follows content; labels on one line; descriptions at most two lines.
- [ ] If icons are shown, they finished loading (no letter avatars) before capture.
- [ ] Illustration ground distinct from the card; no concrete names anywhere in the illustration.
- [ ] Any names, dates, and counts come from live or live-seeded data (skip if the guide shows none).
- [ ] No render error after the guide appears and after its action runs, if it has one (check for the error boundary text).

## CDP measurements

Run in the main window target through `Runtime.evaluate`.

Alignment:

```js
;(() => {
  const card = document.querySelector('[data-radix-popper-content-wrapper] > *')?.getBoundingClientRect()
  const cut = [...document.querySelectorAll('div[aria-hidden]')]
    .find((d) => d.className.includes('9999px'))
    ?.getBoundingClientRect()
  return { cardLeft: card?.left, cutoutLeft: cut?.left, width: card?.width, height: card?.height }
})()
```

Icons loaded inside a container `root`:

```js
const fallbacks = [...root.querySelectorAll('[data-slot=avatar-fallback]')].filter((e) => e.textContent.trim().length === 1)
// wait and retry until fallbacks.length === 0
```

Select a dialog by its title, not by `[role=dialog]` alone: a lazily kept model selector is also a hidden dialog.
