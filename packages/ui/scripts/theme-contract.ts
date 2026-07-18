/**
 * Machine-readable public variable contract.
 *
 * Stability and Tailwind exposure are independent decisions:
 * - stable product variables are valid defaults for new product code;
 * - migration variables exist only to preserve historical rendering while
 *   consumers are replaced;
 * - Tailwind color variables are generated only for roles used as utilities.
 */

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

export const CHERRY_STABLE_PRODUCT_VARIABLE_TOKENS = [
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
  'list-item',
  'list-item-foreground',
  'list-item-hover',
  'list-item-radius',
  'navbar',
  'navbar-foreground',
  'navbar-translucent',
  'modal',
  'modal-foreground',
  'chat',
  'chat-foreground',
  'chat-user',
  'chat-assistant',
  'chat-assistant-foreground',
  'chat-user-foreground',
  'sidebar-active-bg',
  'sidebar-active-foreground',
  'sidebar-active-border',
  'sidebar-glow-bg',
  'sidebar-glow-line'
] as const

export const CHERRY_MIGRATION_PRODUCT_VARIABLE_TOKENS = [
  'icon',
  'text-primary',
  'text-secondary',
  'text-tertiary',
  'text-light',
  'background-soft',
  'background-muted',
  'background-translucent',
  'border-soft',
  'border-faint',
  'fill-secondary',
  'frame-border',
  'group-background',
  'interactive-hover',
  'interactive-active',
  'system-gray-1',
  'system-gray-2',
  'system-gray-3',
  'icon-contrast',
  'primary-soft',
  'primary-subtle'
] as const

export const CHERRY_PRODUCT_VARIABLE_TOKENS = [
  ...CHERRY_STABLE_PRODUCT_VARIABLE_TOKENS,
  ...CHERRY_MIGRATION_PRODUCT_VARIABLE_TOKENS
] as const

export const CHERRY_PRODUCT_COLOR_TOKENS = [
  'background-subtle',
  'background-subtle-foreground',
  'border-subtle',
  'border-strong',
  'icon',
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
  ['list-item', 'list-item-foreground'],
  ['navbar', 'navbar-foreground'],
  ['modal', 'modal-foreground'],
  ['chat', 'chat-foreground'],
  ['chat-user', 'chat-user-foreground'],
  ['chat-assistant', 'chat-assistant-foreground'],
  ['sidebar-active-bg', 'sidebar-active-foreground']
] as const
