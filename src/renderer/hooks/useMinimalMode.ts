import { createContext, type ReactNode, use } from 'react'

export type MinimalHomeKind = 'agent' | 'assistant'

export interface MinimalModeContextValue {
  homeKind: MinimalHomeKind
  switchHome: (kind: MinimalHomeKind) => void
  sidebarHeader?: ReactNode
  renderSidebarToggle?: (sidebarOpen: boolean, onSidebarToggle?: () => void) => ReactNode
  sidebarFooter?: ReactNode
  renderHomeToolbar?: (sidebarOpen: boolean, topBar: ReactNode) => ReactNode
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
