import '@renderer/databases'

import { useTabs } from '@renderer/hooks/useTabs'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import type { TabType } from '@shared/data/cache/cacheValueTypes'
import { Activity, useEffect, useRef } from 'react'

import { AppShellTabBar } from '../../components/layout/AppShellTabBar'
import { TabRouter } from '../../components/layout/TabRouter'

// Mock Webview component (TODO: Replace with actual MinApp/Webview)
const WebviewContainer = ({ url, isActive }: { url: string; isActive: boolean }) => (
  <Activity mode={isActive ? 'visible' : 'hidden'}>
    <div className="flex h-full w-full flex-col items-center justify-center bg-background">
      <div className="mb-2 font-bold text-lg">Webview App</div>
      <code className="rounded bg-muted p-2">{url}</code>
    </div>
  </Activity>
)

export const DetachedAppShell = () => {
  const { tabs, activeTabId, setActiveTab, closeTab, updateTab, addTab, reorderTabs, openTab, unpinTab } = useTabs()
  const initialized = useRef(false)

  // Initialize tab from URL parameters
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const searchParams = new URLSearchParams(window.location.search)
    const url = searchParams.get('url')
    const title = searchParams.get('title')
    const tabId = searchParams.get('tabId')
    const type = searchParams.get('type') as TabType
    const isPinned = searchParams.get('isPinned') === 'true'

    if (url && tabId) {
      // 如果是 Pinned Tab，它应该已经通过 usePersistCache 自动加载了
      // 但我们需要确保它被选中
      if (isPinned) {
        // 等待 storage 同步可能需要一点时间，或者它已经存在
        // 我们尝试选中它
        setActiveTab(tabId)
      } else {
        // 如果是 Normal Tab，我们需要手动添加它
        openTab(url, {
          id: tabId,
          title: title || undefined,
          type: type || 'route',
          forceNew: true
        })
      }
    }
  }, [openTab, setActiveTab])

  // Custom close handler for pinned tabs in detached window
  const handleCloseTab = (id: string) => {
    const tab = tabs.find((t) => t.id === id)
    if (tab?.isPinned) {
      // 取消固定 (会从 persistent storage 移除)
      unpinTab(id)
      // 注意：unpinTab 后它会变成 normal tab 留在列表中
      // 我们需要确保它被关闭
      // 由于 state update 是异步的，这里可能需要一种方式确保后续关闭
      // 但在当前 Context 实现中，unpinTab 只是修改了 lists
      // 我们可以紧接着调用 closeTab，因为 id 没变
    }
    closeTab(id)

    // 如果关闭了最后一个 tab，应该关闭窗口
    // 这通常由 Main Process 监听窗口内 Tab 数量变化，或者 Renderer 发送指令
    if (tabs.length <= 1) {
      // TODO: IPC call to close window
      // window.electron.ipcRenderer.send('window:close')
    }
  }

  // Sync internal navigation back to tab state with default title
  const handleUrlChange = (tabId: string, url: string) => {
    updateTab(tabId, { url, title: getDefaultRouteTitle(url) })
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Zone 1: Tab Bar (Full width, no sidebar gap) */}
      <AppShellTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        setActiveTab={setActiveTab}
        closeTab={handleCloseTab}
        addTab={addTab}
        reorderTabs={reorderTabs}
        isDetached={true}
      />

      {/* Zone 2: Content Area - Multi MemoryRouter Architecture */}
      <main className="relative flex-1 overflow-hidden bg-background">
        {/* Route Tabs: Only render non-dormant tabs */}
        {tabs
          .filter((t) => t.type === 'route' && !t.isDormant)
          .map((tab) => (
            <TabRouter
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onUrlChange={(url) => handleUrlChange(tab.id, url)}
            />
          ))}

        {/* Webview Tabs: Only render non-dormant tabs */}
        {tabs
          .filter((t) => t.type === 'webview' && !t.isDormant)
          .map((tab) => (
            <WebviewContainer key={tab.id} url={tab.url} isActive={tab.id === activeTabId} />
          ))}
      </main>
    </div>
  )
}
