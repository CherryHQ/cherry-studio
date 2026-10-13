---
description: Matching Cherry's look from a mini app — the served /__cherry/theme.css, the stable CSS variable contract, dark mode, fonts and Tailwind mapping
sources:
  - src/main/features/miniApp/runtime/protocol.ts
  - packages/ui/scripts/theme-contract.ts
  - packages/ui/scripts/build-theme-css.ts
---

# Theming

A mini app looks like Cherry by using Cherry's design tokens, not by sharing components. The host serves one stylesheet with every token as a CSS custom property; you reference the variables.

## Include the stylesheet

```html
<link rel="stylesheet" href="/__cherry/theme.css" />
```

| Property | Value |
|---|---|
| Path | `/__cherry/theme.css`, virtual — not a file in your package; `__cherry` is reserved |
| Contents | Every `--cs-*` foundation token plus the semantic variables below, for light and dark |
| Caching | `no-cache`; the file tracks the host version, so a Cherry update can change primitive values |
| Versioning | None. Semantic variable names are kept stable by convention; the file carries no alias block, so a rename is a breaking host change and is announced as one |
| Rules | It defines only custom properties — light values on `:root`, dark values under `@media (prefers-color-scheme: dark)` and a `.dark` class block. No element styles, no resets; your own CSS is untouched |

## The stable contract

Two groups of unprefixed variables are the public contract: the host keeps their names stable across versions. Nothing enforces this yet — treat a rename as a breaking host change. Use these.

**Shadcn semantics** (colors, plus `--radius`):

```
--background --foreground --card --card-foreground --popover --popover-foreground
--primary --primary-foreground --secondary --secondary-foreground --muted --muted-foreground
--accent --accent-foreground --destructive --destructive-foreground --border --input --ring
--chart-1 … --chart-5
--sidebar --sidebar-foreground --sidebar-primary --sidebar-primary-foreground
--sidebar-accent --sidebar-accent-foreground --sidebar-border --sidebar-ring
--radius
```

**Product semantics:**

| Group | Variables |
|---|---|
| Surfaces and borders | `--background-subtle` `--foreground-tertiary` `--foreground-disabled` `--border-subtle` `--border-strong` `--border-selected` `--link` |
| Feedback | `--success` `--warning` `--info` `--error`, each with `-subtle`, `-subtle-foreground`, `-border` |
| Content | `--code-block` `--inline-code` `--inline-code-foreground` `--reference` `--reference-foreground` `--reference-subtle` `--highlight` `--highlight-foreground` `--highlight-accent` `--chat-user` |
| Lists | `--resource-list-row-hover` `--resource-list-row-active` `--resource-list-row-active-foreground` `--resource-list-row-selected` `--resource-list-row-selected-foreground` |

Use them directly in `color`, `background`, `border-color`. Do not parse the values: most are `oklch(...)`, but the Content group holds hex and `rgba()` too, and the format is not part of the contract.

**Foundation tokens** (`--cs-*`: palettes such as `--cs-brand-500`, typography `--cs-font-family-body`, `--cs-font-size-body-md`, `--cs-font-weight-medium`, radius and spacing scales) are present in the file but are **not** part of the contract — they can change between host versions. Prefer the semantic variables; reach for `--cs-*` only for one-off accents.

```css
body {
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  font-family: var(--cs-font-family-body, system-ui, sans-serif);
}
button {
  background: var(--primary);
  color: var(--primary-foreground);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.hint { color: var(--muted-foreground); }
.error { color: var(--error); background: var(--error-subtle); }
```

## Dark mode

Automatic, zero code. The host applies the user's Cherry theme to the webview, so `prefers-color-scheme` is correct and updates live, and the stylesheet ships its dark values under `@media (prefers-color-scheme: dark)`. Every variable above switches with the user's theme; you write `var(--background)` once.

When your script needs the value or the change, use the browser channel — there is no `theme` field on `cherry.app.getInfo()` and no theme event:

```js
const dark = matchMedia('(prefers-color-scheme: dark)')
dark.addEventListener('change', ({ matches }) => redraw(matches))
```

The same dark values are also available under a `.dark` class block, so an app that wants to override the user's choice can add `class="dark"` to `<html>` by hand.

## Fonts

`--cs-font-family-heading` and `--cs-font-family-body` are family names (`Inter`), not embedded fonts. Cherry does not ship the font files either — it falls back to the system font when Inter is not installed, and your app falls back identically, so it stays consistent without distributing anything. Cherry's icon font is not served; bundle your own icons.

## Tailwind CSS

No preset is shipped. With Tailwind v4, map the contract into utilities with `@theme inline` in your own stylesheet; Tailwind reads the variables at build time and your utilities resolve at runtime through `theme.css`:

```css
@import 'tailwindcss';

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-error: var(--error);
  --radius-md: var(--radius);
}
```

Then `class="bg-background text-foreground border-border"` follows the host theme in both modes, and Tailwind's default `dark:` variant works as-is because it is driven by `prefers-color-scheme`. Build the CSS into the package — the page cannot load Tailwind from a CDN.
