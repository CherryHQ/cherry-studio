import type { SidebarLayout } from './types'

export const SIDEBAR_ICON_WIDTH = 50
export const SIDEBAR_MAX_WIDTH = 280

export const SIDEBAR_HIDDEN_THRESHOLD = 20
export const SIDEBAR_FULL_THRESHOLD = 120

export function getSidebarLayout(width: number): SidebarLayout {
  if (width < SIDEBAR_HIDDEN_THRESHOLD) return 'hidden'
  if (width < SIDEBAR_FULL_THRESHOLD) return 'icon'
  return 'full'
}

// Widths between icon and full exist only as transient drag previews — they
// must never be persisted. All band checks go through this predicate so a
// boundary change cannot silently fork between call sites.
export function isIntermediateSidebarWidth(width: number): boolean {
  return width > SIDEBAR_ICON_WIDTH && width < SIDEBAR_FULL_THRESHOLD
}

// Persist-time: collapses intermediate widths to the icon width.
export function normalizeSidebarWidth(width: number): number {
  if (isIntermediateSidebarWidth(width)) return SIDEBAR_ICON_WIDTH
  return width
}

// Render-time: deliberately passes intermediate widths through (unlike the
// icon branch below) so the live drag preview follows the cursor.
export function getSidebarDisplayWidth(width: number): number {
  if (isIntermediateSidebarWidth(width)) return width
  if (getSidebarLayout(width) === 'icon') return SIDEBAR_ICON_WIDTH
  return width
}
