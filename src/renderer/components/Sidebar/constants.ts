import type { SidebarLayout } from './types'

export const SIDEBAR_ICON_WIDTH = 50
export const SIDEBAR_SNAP_THRESHOLD = 65
export const SIDEBAR_FULL_WIDTH = 170
export const SIDEBAR_MAX_WIDTH = 280

export const SIDEBAR_HIDDEN_THRESHOLD = 20
export const SIDEBAR_FULL_THRESHOLD = 120

export function getSidebarLayout(width: number): SidebarLayout {
  if (width < SIDEBAR_HIDDEN_THRESHOLD) return 'hidden'
  if (width < SIDEBAR_FULL_THRESHOLD) return 'icon'
  return 'full'
}
