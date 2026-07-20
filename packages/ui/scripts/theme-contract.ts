/**
 * Machine-readable theme contract.
 *
 * Runtime inputs are host-written internal values, not public component roles.
 * Stability and Tailwind exposure are independent decisions:
 * - stable product variables are valid defaults for new product code;
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
  'background-subtle-foreground',
  'border-subtle',
  'border-strong',

  /* Feedback */
  'success',
  'success-foreground',
  'success-subtle',
  'success-subtle-foreground',
  'success-border',
  'warning',
  'warning-foreground',
  'warning-subtle',
  'warning-subtle-foreground',
  'warning-border',
  'info',
  'info-foreground',
  'info-subtle',
  'info-subtle-foreground',
  'info-border',
  'error',
  'error-foreground',
  'error-subtle',
  'error-subtle-foreground',
  'error-border',

  /* Product domains */
  'link',
  'code-block',
  'code-block-foreground',
  'inline-code',
  'inline-code-foreground',
  'reference',
  'reference-foreground',
  'reference-subtle',
  'highlight',
  'highlight-foreground',
  'highlight-accent',
  'chat-user',
  'chat-user-foreground',
  'sidebar-active-bg',
  'sidebar-active-foreground',
  'sidebar-active-border',
  'sidebar-glow-bg',
  'sidebar-glow-line'
] as const

export const CHERRY_PRODUCT_COLOR_TOKENS = [
  'background-subtle',
  'background-subtle-foreground',
  'border-subtle',
  'border-strong',
  'sidebar-active-bg',
  'sidebar-active-foreground',
  'sidebar-active-border',
  'sidebar-glow-bg',
  'sidebar-glow-line',
  'success',
  'success-foreground',
  'success-subtle',
  'success-subtle-foreground',
  'success-border',
  'warning',
  'warning-foreground',
  'warning-subtle',
  'warning-subtle-foreground',
  'warning-border',
  'info',
  'info-foreground',
  'info-subtle',
  'info-subtle-foreground',
  'info-border',
  'error',
  'error-foreground',
  'error-subtle',
  'error-subtle-foreground',
  'error-border'
] as const

export const CHERRY_PRODUCT_SURFACE_PAIRS = [
  ['background-subtle', 'background-subtle-foreground'],
  ['success', 'success-foreground'],
  ['success-subtle', 'success-subtle-foreground'],
  ['warning', 'warning-foreground'],
  ['warning-subtle', 'warning-subtle-foreground'],
  ['info', 'info-foreground'],
  ['info-subtle', 'info-subtle-foreground'],
  ['error', 'error-foreground'],
  ['error-subtle', 'error-subtle-foreground'],
  ['code-block', 'code-block-foreground'],
  ['inline-code', 'inline-code-foreground'],
  ['reference', 'reference-foreground'],
  ['highlight', 'highlight-foreground'],
  ['chat-user', 'chat-user-foreground'],
  ['sidebar-active-bg', 'sidebar-active-foreground']
] as const
