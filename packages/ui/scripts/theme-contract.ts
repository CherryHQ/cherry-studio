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

export const CHERRY_STABLE_PRODUCT_VARIABLE_TOKENS = [
  /* Shared product semantics */
  'background-subtle',
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
  'inline-code',
  'inline-code-foreground',
  'reference',
  'reference-foreground',
  'reference-subtle',
  'highlight',
  'highlight-foreground',
  'highlight-accent',
  'list-item',
  'list-item-hover',
  'list-item-radius',
  'navbar',
  'navbar-translucent',
  'modal',
  'chat',
  'chat-user',
  'chat-assistant',
  'chat-user-foreground',
  'sidebar-active-bg',
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
  'border-subtle',
  'border-strong',
  'icon',
  'sidebar-active-bg',
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
