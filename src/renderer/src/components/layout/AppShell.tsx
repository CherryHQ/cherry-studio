import { cn, Tabs, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { Plus, X } from 'lucide-react'
import { Activity } from 'react'
import { v4 as uuid } from 'uuid'

import { useTabs } from '../../hooks/useTabs'
import Sidebar from '../app/Sidebar'
import { TabRouter } from './TabRouter'

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
  const { tabs, activeTabId, setActiveTab, closeTab, updateTab, addTab } = useTabs()

  // Sync internal navigation back to tab state
  const handleUrlChange = (tabId: string, url: string) => {
    updateTab(tabId, { url })
  }

  // 新增 Tab（默认打开首页）
  const handleAddTab = () => {
    addTab({
      id: uuid(),
      type: 'route',
      url: '/',
      title: 'New Tab',
    })
  }

  return (
    <div className="flex h-screen w-screen flex-row overflow-hidden bg-background text-foreground">
      {/* Zone 1: Sidebar */}
      <Sidebar />

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
              {/* 新增 Tab 按钮 - 跟随最后一个 Tab */}
              <button
                type="button"
                onClick={handleAddTab}
                className="flex h-full shrink-0 items-center justify-center px-3 hover:bg-muted/50"
                title="New Tab">
                <Plus className="size-4" />
              </button>
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
