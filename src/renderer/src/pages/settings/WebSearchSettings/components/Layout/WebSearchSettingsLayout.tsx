import { useLocation, useNavigate } from '@tanstack/react-router'
import type { FC, ReactNode } from 'react'
import { createContext, use, useCallback, useMemo } from 'react'

interface NavContextValue {
  isActive: (path: string) => boolean
  navigateTo: (path: string) => void
}

const NavContext = createContext<NavContextValue | null>(null)

export const useWebSearchSettingsNav = () => {
  const context = use(NavContext)

  if (!context) {
    throw new Error('WebSearchSettingsLayout context is missing')
  }

  return context
}

const WebSearchSettingsLayoutRoot: FC<{ children: ReactNode }> = ({ children }) => {
  const navigate = useNavigate()
  const location = useLocation()

  const isActive = useCallback((path: string) => location.pathname === path, [location.pathname])
  const navigateTo = useCallback((path: string) => navigate({ to: path }), [navigate])

  const value = useMemo(() => ({ isActive, navigateTo }), [isActive, navigateTo])

  return (
    <NavContext value={value}>
      <div className="flex h-[calc(100vh-var(--navbar-height)-6px)] w-full flex-1 flex-row overflow-hidden">
        {children}
      </div>
    </NavContext>
  )
}

const WebSearchSettingsLayoutSidebar: FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <div className="flex h-[calc(100vh-var(--navbar-height))] w-(--settings-width) flex-col gap-2 border-border border-r p-2">
      {children}
    </div>
  )
}

const WebSearchSettingsLayoutContent: FC<{ children: ReactNode }> = ({ children }) => {
  return <div className="flex flex-1">{children}</div>
}

export const WebSearchSettingsLayout = Object.assign(WebSearchSettingsLayoutRoot, {
  Sidebar: WebSearchSettingsLayoutSidebar,
  Content: WebSearchSettingsLayoutContent
})
