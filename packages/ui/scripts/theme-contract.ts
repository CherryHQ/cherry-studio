/**
 * Machine-readable theme contract.
 *
 * Runtime inputs are host-written internal values, not public component roles.
 * Stability and Tailwind exposure are independent decisions:
 * - stable unprefixed product variables are valid defaults for new product code;
 * - migration variables exist only to preserve historical rendering while
 *   consumers are replaced;
 * - Tailwind color variables are generated only for roles used as utilities.
 */

export const RUNTIME_THEME_INPUT_TOKENS = ['primary'] as const

export const SHADCN_COLOR_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring'
] as const

export const SHADCN_VARIABLE_TOKENS = [...SHADCN_COLOR_TOKENS, 'radius'] as const

export const SHADCN_SURFACE_PAIRS = [
  ['background', 'foreground'],
  ['card', 'card-foreground'],
  ['popover', 'popover-foreground'],
  ['primary', 'primary-foreground'],
  ['secondary', 'secondary-foreground'],
  ['muted', 'muted-foreground'],
  ['accent', 'accent-foreground'],
  ['destructive', 'destructive-foreground'],
  ['sidebar', 'sidebar-foreground'],
  ['sidebar-primary', 'sidebar-primary-foreground'],
  ['sidebar-accent', 'sidebar-accent-foreground']
] as const

export const CHERRY_PRODUCT_VARIABLE_TOKENS = [
  /* Shared product semantics */
  'background-subtle',
  'border-subtle',
  'border-strong',

  /* Feedback */
  'success',
  'success-subtle',
  'success-subtle-foreground',
  'success-border',
  'warning',
  'warning-subtle',
  'warning-subtle-foreground',
  'warning-border',
  'info',
  'info-subtle',
  'info-subtle-foreground',
  'info-border',
  'error',
  'error-subtle',
  'error-subtle-foreground',
  'error-border',

  /* Product domains */
  'link',
  'code-block',
  'inline-code',
  'inline-code-foreground',
  'reference',
  'reference-foreground',
  'reference-subtle',
  'highlight',
  'highlight-foreground',
  'highlight-accent',
  'chat-user',
  'sidebar-active-bg',
  'sidebar-active-border',
  'sidebar-glow-bg',
  'sidebar-glow-line'
] as const

export const CHERRY_PRODUCT_COLOR_TOKENS = [
  'background-subtle',
  'border-subtle',
  'border-strong',
  'sidebar-active-bg',
  'sidebar-active-border',
  'sidebar-glow-bg',
  'sidebar-glow-line',
  'success',
  'success-subtle',
  'success-subtle-foreground',
  'success-border',
  'warning',
  'warning-subtle',
  'warning-subtle-foreground',
  'warning-border',
  'info',
  'info-subtle',
  'info-subtle-foreground',
  'info-border',
  'error',
  'error-subtle',
  'error-subtle-foreground',
  'error-border'
] as const

/**
 * Frozen Tailwind compatibility surface for historical semantic utilities.
 * These lists are shrink-only: adding a foundation token must not expose a
 * new utility unless an existing compatibility consumer requires it.
 */
export const COMPATIBILITY_SEMANTIC_COLOR_TOKENS = [
  'primary-hover',
  'destructive-hover',
  'foreground-secondary',
  'foreground-muted',
  'menu-item-hover',
  'border-muted',
  'border-hover',
  'border-active',
  'secondary-hover',
  'secondary-active',
  'ghost-hover',
  'ghost-active'
] as const

export const COMPATIBILITY_STATUS_COLOR_TOKENS = [
  'error-base',
  'error-text',
  'error-bg',
  'error-text-hover',
  'error-bg-hover',
  'error-border-hover',
  'error-active',
  'success-base',
  'success-text-hover',
  'success-bg',
  'success-bg-hover',
  'warning-base',
  'warning-text-hover',
  'warning-bg',
  'warning-bg-hover',
  'warning-active',
  'info-base',
  'info-text-hover',
  'info-bg',
  'info-bg-hover',
  'info-active'
] as const

export const COMPATIBILITY_COLOR_TOKENS = [
  ...COMPATIBILITY_SEMANTIC_COLOR_TOKENS,
  ...COMPATIBILITY_STATUS_COLOR_TOKENS
] as const

export const CHERRY_PRODUCT_SURFACE_PAIRS = [
  ['success-subtle', 'success-subtle-foreground'],
  ['warning-subtle', 'warning-subtle-foreground'],
  ['info-subtle', 'info-subtle-foreground'],
  ['error-subtle', 'error-subtle-foreground'],
  ['inline-code', 'inline-code-foreground'],
  ['reference', 'reference-foreground'],
  ['highlight', 'highlight-foreground']
] as const
