import type { SidebarLayout } from './types'

export const SIDEBAR_ICON_WIDTH = 50
export const SIDEBAR_VERTICAL_CARD_WIDTH = 65
export const SIDEBAR_FULL_WIDTH = 170
export const SIDEBAR_MAX_WIDTH = 280

export const SIDEBAR_HIDDEN_THRESHOLD = 20
export const SIDEBAR_ICON_THRESHOLD = 58
export const SIDEBAR_FULL_THRESHOLD = 120

export function getSidebarLayout(width: number): SidebarLayout {
  if (width < SIDEBAR_HIDDEN_THRESHOLD) return 'hidden'
  if (width < SIDEBAR_ICON_THRESHOLD) return 'icon'
  if (width < SIDEBAR_FULL_THRESHOLD) return 'vertical-card'
  return 'full'
}
