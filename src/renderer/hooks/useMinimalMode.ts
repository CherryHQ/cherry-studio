import { createContext, type ReactNode, use, useMemo } from 'react'

import { TabIdContext } from './tab'

export interface MinimalModeContextValue {
  renderSidebarHeader?: (onAddAgent?: () => void | Promise<void>) => ReactNode
  renderSidebarToggle?: (sidebarOpen: boolean, onSidebarToggle?: () => void) => ReactNode
  sidebarFooter?: ReactNode
  renderHomeToolbar?: (sidebarOpen: boolean, topBar: ReactNode) => ReactNode
  enabled: boolean
  homeTabId?: string
}

export const MinimalModeContext = createContext<MinimalModeContextValue | null>(null)

export function useMinimalMode() {
  const mode = use(MinimalModeContext)
  const isHome = !!mode?.enabled && mode.homeTabId !== undefined && use(TabIdContext) === mode.homeTabId
  return useMemo(() => (mode ? { ...mode, isHome } : null), [mode, isHome])
}
