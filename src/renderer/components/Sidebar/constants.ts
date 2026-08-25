import type { SidebarLayout } from './types'

export const SIDEBAR_ICON_WIDTH = 50
export const SIDEBAR_MAX_WIDTH = 280

export const SIDEBAR_HIDDEN_THRESHOLD = 20
export const SIDEBAR_FULL_THRESHOLD = 120

// A hidden sidebar still holds a gutter that keeps the content card off the window edge.
// Layout anchored to the column has to count it, or the tab strip shifts on collapse.
export const SIDEBAR_HIDDEN_GUTTER = 8

// Fallback width for the hover overlay. It always renders labels, so a remembered
// icon-band width would leave it unreadable rather than merely narrow.
export const SIDEBAR_PEEK_WIDTH = 174

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

// The hover overlay reopens at the width the user last had, so peeking after a
// collapse looks like the sidebar they closed rather than a stock-width panel.
export function getSidebarPeekWidth(expandedWidth: number): number {
  return getSidebarLayout(expandedWidth) === 'full' ? expandedWidth : SIDEBAR_PEEK_WIDTH
}

// Footprint of the column, unlike getSidebarDisplayWidth which reports the sidebar
// itself and drops to 0 once hidden.
export function getSidebarColumnWidth(width: number): number {
  return getSidebarLayout(width) === 'hidden' ? SIDEBAR_HIDDEN_GUTTER : getSidebarDisplayWidth(width)
}
