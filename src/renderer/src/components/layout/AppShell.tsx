// TODO demo component
import { cn } from '@cherrystudio/ui'
import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { useEffect } from 'react'

import { useTabs } from '../../hooks/useTabs'

// Mock Sidebar component (Replace with actual one later)
const Sidebar = ({ onNavigate }: { onNavigate: (id: string) => void }) => {
  // Helper to render a Sidebar Link that acts as a Tab Switcher
  const SidebarItem = ({ to, title, id }: { to: string; title: string; id: string }) => (
    <Link
      to={to}
      className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent data-[status=active]:bg-primary/20 data-[status=active]:font-bold"
      activeProps={{
        'data-status': 'active'
      }}
      onClick={(e) => {
        // Intercept the router navigation!
        // We want to switch tabs, not just navigate within the current tab.
        e.preventDefault()
        onNavigate(id)
      }}>
      {title.slice(0, 1).toUpperCase() + title.slice(1, 3)}
    </Link>
  )

  return (
    <aside className="flex h-full w-16 flex-col items-center gap-4 border-r bg-muted/10 py-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/20 font-bold text-xs">Logo</div>

      <SidebarItem to="/" title="Home" id="home" />
      <SidebarItem to="/settings" title="Settings" id="settings" />

      <div className="flex-1" />
      <button type="button" className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent">
        User
      </button>
    </aside>
  )
}

// Mock MinApp component (Replace with actual implementation)
const MinApp = ({ url }: { url: string }) => (
  <div className="flex h-full w-full flex-col items-center justify-center bg-background">
    <div className="mb-2 font-bold text-lg">Webview App</div>
    <code className="rounded bg-muted p-2">{url}</code>
  </div>
)

export const AppShell = () => {
  const { tabs, activeTabId, setActiveTab, closeTab, addTab, updateTab } = useTabs()
  const navigate = useNavigate()
  const location = useLocation()

  // 1. Sync Route -> Tab (Handle internal navigation & deep links)
  useEffect(() => {
    const currentPath = location.pathname
    const activeTab = tabs.find((t) => t.id === activeTabId)

    if (activeTab?.type === 'url' && activeTab.url !== currentPath) {
      const existingTab = tabs.find((t) => t.type === 'url' && t.url === currentPath && t.id !== activeTabId)
      if (existingTab) {
        setActiveTab(existingTab.id)
      } else {
        // Sync URL changes back to DB
        updateTab(activeTabId, { url: currentPath })
      }
    }
  }, [location.pathname, tabs, activeTabId, setActiveTab, updateTab])

  // 2. Sync Tab -> Route (Handle tab switching)
  useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId)
    if (!activeTab) return

    if (activeTab.type === 'url') {
      if (location.pathname !== activeTab.url) {
        navigate({ to: activeTab.url })
      }
    }
  }, [activeTabId, tabs, navigate, location.pathname])

  const handleSidebarClick = (menuId: string) => {
    let targetUrl = ''
    let targetTitle = ''

    switch (menuId) {
      case 'home':
        targetUrl = '/'
        targetTitle = 'Home'
        break
      case 'settings':
        targetUrl = '/settings'
        targetTitle = 'Settings'
        break
      default:
        return
    }

    const existingTab = tabs.find((t) => t.type === 'url' && t.url === targetUrl)

    if (existingTab) {
      setActiveTab(existingTab.id)
    } else {
      addTab({
        id: `${menuId}-${Date.now()}`,
        type: 'url',
        url: targetUrl,
        title: targetTitle
      })
    }
  }

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const isWebviewActive = activeTab?.type === 'webview'

  return (
    <div className="flex h-screen w-screen flex-row overflow-hidden bg-background text-foreground">
      {/* Zone 1: Sidebar */}
      <Sidebar onNavigate={handleSidebarClick} />

      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* Zone 2: Tab Bar */}
        <header className="flex h-10 w-full items-center border-b bg-muted/5">
          <div className="hide-scrollbar flex-1 overflow-x-auto">
            <div className="flex h-full w-full items-center justify-start">
              {tabs.map((tab) => (
                <Link
                  key={tab.id}
                  to={tab.url}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'relative flex h-full min-w-[120px] max-w-[200px] items-center justify-between gap-2 border-border/40 border-r px-3 py-2 text-sm transition-colors hover:bg-muted/50',
                    tab.id === activeTabId ? 'bg-background shadow-sm' : 'bg-transparent opacity-70 hover:opacity-100'
                  )}>
                  <span className="truncate text-xs">{tab.title}</span>
                  <div
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      closeTab(tab.id)
                    }}
                    className="ml-1 cursor-pointer rounded-sm p-0.5 opacity-50 hover:bg-muted-foreground/20 hover:opacity-100">
                    <X className="size-3" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </header>

        {/* Zone 3: Content Area (Simplified Hybrid Architecture) */}
        <main className="relative flex-1 overflow-hidden bg-background">
          {/* Layer A: Standard Router Outlet */}
          {/* Always rendered, but hidden if a webview is active. This keeps the Router alive. */}
          <div
            style={{
              display: isWebviewActive ? 'none' : 'block',
              height: '100%',
              width: '100%'
            }}>
            <Outlet />
          </div>

          {/* Layer B: Webview Apps (Overlay) */}
          {tabs.map((tab) => {
            if (tab.type !== 'webview') return null
            return (
              <div
                key={tab.id}
                style={{
                  display: tab.id === activeTabId ? 'block' : 'none',
                  height: '100%',
                  width: '100%'
                }}>
                <MinApp url={tab.url} />
              </div>
            )
          })}
        </main>
      </div>
    </div>
  )
}
