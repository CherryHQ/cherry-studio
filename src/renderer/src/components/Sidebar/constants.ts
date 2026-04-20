import type { SidebarLayout } from './types'

export const SIDEBAR_ICON_WIDTH = 50
export const SIDEBAR_VERTICAL_CARD_WIDTH = 65
export const SIDEBAR_FULL_WIDTH = 170
export const SIDEBAR_MAX_WIDTH = 280

export function getSidebarLayout(width: number): SidebarLayout {
  if (width < 20) return 'hidden'
  if (width < 58) return 'icon'
  if (width < 120) return 'vertical-card'
  return 'full'
}
