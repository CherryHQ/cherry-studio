import { createContext, type ReactNode, use } from 'react'

export interface MinimalModeContextValue {
  renderHomeToolbar?: (sidebarOpen: boolean, topBar: ReactNode, onSidebarToggle?: () => void) => ReactNode
  sidebarToolbarActions?: ReactNode
  enabled: boolean
  isHome: boolean
  returnHome: () => void
  openFeature: (url: string) => void
}

export const MinimalModeContext = createContext<MinimalModeContextValue | null>(null)

export function useMinimalMode() {
  return use(MinimalModeContext)
}
