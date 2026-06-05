import type { SidebarLayout } from './types'

export const SIDEBAR_ICON_WIDTH = 50
export const SIDEBAR_RELEASE_DELTA = 15
export const SIDEBAR_FULL_WIDTH = 170
export const SIDEBAR_MAX_WIDTH = 280

export const SIDEBAR_HIDDEN_THRESHOLD = 20
export const SIDEBAR_FULL_THRESHOLD = 120

export function getSidebarLayout(width: number): SidebarLayout {
  if (width < SIDEBAR_HIDDEN_THRESHOLD) return 'hidden'
  if (width < SIDEBAR_FULL_THRESHOLD) return 'icon'
  return 'full'
}

export function normalizeSidebarWidth(width: number): number {
  if (width > SIDEBAR_ICON_WIDTH && width < SIDEBAR_FULL_THRESHOLD) return SIDEBAR_ICON_WIDTH
  return width
}

export function getSidebarDisplayWidth(width: number): number {
  if (getSidebarLayout(width) === 'icon') return SIDEBAR_ICON_WIDTH
  return width
}
