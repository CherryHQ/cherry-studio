import { cn, Tabs, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { X } from 'lucide-react'
import { Activity } from 'react'
import { v4 as uuid } from 'uuid'

import { useTabs } from '../../hooks/useTabs'
import { TabRouter } from './TabRouter'

// Mock Sidebar component (TODO: Replace with actual Sidebar)
const Sidebar = ({ onNavigate }: { onNavigate: (path: string, title: string) => void }) => {
  const menuItems = [
    { path: '/', title: 'Home', icon: 'H' },
    { path: '/settings', title: 'Settings', icon: 'S' }
  ]

  return (
    <aside className="flex h-full w-16 flex-col items-center gap-4 border-r bg-muted/10 py-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/20 font-bold text-xs">Logo</div>

      {menuItems.map((item) => (
        <button
          key={item.path}
          type="button"
          onClick={() => onNavigate(item.path, item.title)}
          className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent">
          {item.icon}
        </button>
      ))}

      <div className="flex-1" />
      <button type="button" className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent">
        U
      </button>
    </aside>
  )
}

// Mock Webview component (TODO: Replace with actual MinApp/Webview)
const WebviewContainer = ({ url, isActive }: { url: string; isActive: boolean }) => (
  <Activity mode={isActive ? 'visible' : 'hidden'}>
    <div className="flex h-full w-full flex-col items-center justify-center bg-background">
      <div className="mb-2 font-bold text-lg">Webview App</div>
      <code className="rounded bg-muted p-2">{url}</code>
    </div>
  </Activity>
)

export const AppShell = () => {
  const { tabs, activeTabId, setActiveTab, closeTab, addTab, updateTab } = useTabs()

  // Sidebar navigation: find existing tab or create new one
  const handleSidebarNavigate = (path: string, title: string) => {
    const existingTab = tabs.find((t) => t.type === 'route' && t.url === path)

    if (existingTab) {
      setActiveTab(existingTab.id)
    } else {
      addTab({
        id: uuid(),
        type: 'route',
        url: path,
        title
      })
    }
  }

  // Sync internal navigation back to tab state
  const handleUrlChange = (tabId: string, url: string) => {
    updateTab(tabId, { url })
  }

  return (
    <div className="flex h-screen w-screen flex-row overflow-hidden bg-background text-foreground">
      {/* Zone 1: Sidebar */}
      <Sidebar onNavigate={handleSidebarNavigate} />

      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* Zone 2: Tab Bar */}
        <Tabs value={activeTabId} onValueChange={setActiveTab} variant="line" className="w-full">
          <header className="flex h-10 w-full items-center border-b bg-muted/5">
            <TabsList className="hide-scrollbar h-full flex-1 justify-start gap-0 overflow-x-auto">
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className={cn(
                    'group relative flex h-full min-w-[120px] max-w-[200px] items-center justify-between gap-2 rounded-none border-r px-3 text-sm',
                    tab.id === activeTabId ? 'bg-background' : 'bg-transparent'
                  )}>
                  <span className="truncate text-xs">{tab.title}</span>
                  {tabs.length > 1 && (
                    <div
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTab(tab.id)
                      }}
                      className="ml-1 cursor-pointer rounded-sm p-0.5 opacity-0 hover:bg-muted-foreground/20 hover:opacity-100 group-hover:opacity-50">
                      <X className="size-3" />
                    </div>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </header>
        </Tabs>

        {/* Zone 3: Content Area - Multi MemoryRouter Architecture */}
        <main className="relative flex-1 overflow-hidden bg-background">
          {/* Route Tabs: Each has independent MemoryRouter */}
          {tabs
            .filter((t) => t.type === 'route')
            .map((tab) => (
              <TabRouter
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                onUrlChange={(url) => handleUrlChange(tab.id, url)}
              />
            ))}

          {/* Webview Tabs */}
          {tabs
            .filter((t) => t.type === 'webview')
            .map((tab) => (
              <WebviewContainer key={tab.id} url={tab.url} isActive={tab.id === activeTabId} />
            ))}
        </main>
      </div>
    </div>
  )
}
