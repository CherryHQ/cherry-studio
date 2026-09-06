import type { CSSProperties } from 'react'

/**
 * Maps our design tokens onto `@pierre/trees`' shadow-root variables.
 *
 * Custom properties pierce the shadow boundary, and the library resolves every
 * token as `--trees-<name>-override` → `--trees-theme-*` → its own default. So
 * setting the override layer to `var(--our-token)` is enough: the values stay
 * live, and light/dark switching keeps working with no JS at all.
 *
 * `themeToTreeStyles()` is deliberately unused. It only fills the middle
 * (`--trees-theme-*`) layer from a VS Code / Shiki theme object, which we do not
 * have — and in `1.0.0-beta.6` it imports `@pierre/theming/color`, a bare
 * specifier the package does not depend on, so it fails to resolve anyway.
 */

/** Matches `DEFAULT_ITEM_SIZE` from the virtual list this component replaced. */
export const FILE_TREE_ITEM_HEIGHT = 28

/** `INDENT_STEP_PX` / `INDENT_BASE_PX` from the old row renderer. */
const INDENT_STEP_PX = 12
const INDENT_BASE_PX = 8
const ICON_SIZE_PX = 16

/**
 * The pane behind the tree paints its own surface, so the panel is transparent
 * and every derived colour is pinned explicitly — nothing is left to the
 * library's `color-mix` chains, which would blend against that transparency.
 */
export const FILE_TREE_THEME_STYLE: CSSProperties = {
  // Surfaces and text
  '--trees-bg-override': 'transparent',
  '--trees-fg-override': 'var(--foreground)',
  '--trees-fg-muted-override': 'var(--muted-foreground)',
  '--trees-accent-override': 'var(--primary)',
  '--trees-border-color-override': 'var(--border-subtle)',
  '--trees-border-radius-override': 'var(--radius-3xs)',

  // Hover and selection — the old rows used `hover:bg-accent/50` and
  // `bg-accent/60 text-accent-foreground`.
  '--trees-bg-muted-override': 'color-mix(in oklab, var(--accent) 50%, transparent)',
  '--trees-selected-bg-override': 'color-mix(in oklab, var(--accent) 60%, transparent)',
  '--trees-selected-fg-override': 'var(--accent-foreground)',
  '--trees-selected-focused-border-color-override': 'var(--ring)',
  '--trees-focus-ring-color-override': 'var(--ring)',
  '--trees-indent-guide-bg-override': 'var(--border-subtle)',

  // Type
  '--trees-font-family-override': 'inherit',
  '--trees-font-size-override': '0.875rem',

  // Metrics
  '--trees-level-gap-override': `${INDENT_STEP_PX}px`,
  '--trees-padding-inline-override': `${INDENT_BASE_PX}px`,
  '--trees-icon-width-override': `${ICON_SIZE_PX}px`,

  // Search field
  '--trees-input-bg-override': 'var(--background)',
  '--trees-search-bg-override': 'color-mix(in oklab, var(--primary) 25%, transparent)',
  '--trees-search-fg-override': 'var(--foreground)',

  '--trees-scrollbar-thumb-override': 'var(--border)'
} as CSSProperties
