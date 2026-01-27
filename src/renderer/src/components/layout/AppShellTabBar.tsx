import { isLinux, isMac, isWin } from '@renderer/config/constant'
import { cn, uuid } from '@renderer/utils'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { IpcChannel } from '@shared/IpcChannel'
import { Home, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Tab } from '../../hooks/useTabs'

const HOME_TAB_ID = 'home'

type AppShellTabBarProps = {
  tabs: Tab[]
  activeTabId: string
  setActiveTab: (id: string) => void
  closeTab: (id: string) => void
  addTab: (tab: Tab) => void
  reorderTabs: (type: 'pinned' | 'normal', oldIndex: number, newIndex: number) => void
  detachTab?: (tabId: string) => void
  attachTab?: (tab: Tab) => void
  /** 是否为分离窗口模式（隐藏 Home tab、"+" 按钮、close icon） */
  isDetached?: boolean
}

const TabCornerRight = () => (
  <svg
    aria-hidden
    className="absolute right-0 bottom-0 size-3 translate-x-full text-background"
    viewBox="0 0 12 12"
    xmlns="http://www.w3.org/2000/svg">
    <path d="M0 0V12H12C5.37258 12 0 6.62742 0 0Z" fill="currentColor" />
  </svg>
)

const TabCornerLeft = () => (
  <svg
    aria-hidden
    className="-translate-x-full absolute bottom-0 left-0 size-3 text-background"
    viewBox="0 0 12 12"
    xmlns="http://www.w3.org/2000/svg">
    <path d="M12 0V12H0C6.62742 12 12 6.62742 12 0Z" fill="currentColor" />
  </svg>
)

const HomeTab = ({ isActive, onClick }: { isActive: boolean; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'flex shrink-0 items-center justify-center rounded-[12px] p-[8px] [-webkit-app-region:no-drag]',
      isActive ? 'bg-background text-foreground' : 'bg-[rgba(107,114,128,0.1)] text-foreground/80'
    )}
    title="Home">
    <Home className="size-5" />
  </button>
)

// Tab 内容渲染
const TabContent = ({
  tab,
  isActive,
  isDragging,
  onClose,
  showClose = true
}: {
  tab: Tab
  isActive: boolean
  isDragging?: boolean
  onClose?: () => void
  showClose?: boolean
}) => (
  <>
    {isActive && (
      <>
        <TabCornerLeft />
        <TabCornerRight />
      </>
    )}
    <span
      className={cn(
        'flex size-5 shrink-0 items-center justify-center text-foreground/80',
        isActive && '@[48px]:flex hidden'
      )}>
      {tab.icon || <Home className="size-5" />}
    </span>
    <span
      className="@[45px]:block hidden min-w-0 flex-1 whitespace-nowrap text-left font-medium text-sm leading-4"
      style={{ maskImage: 'linear-gradient(to right, black 80%, transparent 100%)' }}>
      {tab.title}
    </span>
    {isActive && onClose && !isDragging && showClose && (
      <div
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.stopPropagation()
            onClose()
          }
        }}
        className="ml-auto flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm hover:bg-muted-foreground/20">
        <X className="size-4" />
      </div>
    )}
  </>
)

// 原生拖拽的 Tab 项
const DraggableTabItem = ({
  tab,
  isActive,
  onSelect,
  onClose,
  showClose = true,
  isDragging,
  onDragStart,
  tabRef
}: {
  tab: Tab
  isActive: boolean
  onSelect: () => void
  onClose: () => void
  showClose?: boolean
  isDragging: boolean
  onDragStart: (e: React.DragEvent, tab: Tab) => void
  tabRef: (el: HTMLButtonElement | null) => void
}) => {
  return (
    <button
      ref={tabRef}
      draggable
      onDragStart={(e) => onDragStart(e, tab)}
      data-tab-id={tab.id}
      type="button"
      onClick={() => !isDragging && onSelect()}
      className={cn(
        '@container group relative flex h-full min-w-[40px] max-w-[200px] flex-1 cursor-grab items-center gap-2 px-3 py-0.5 [-webkit-app-region:no-drag]',
        isDragging && 'cursor-grabbing opacity-50',
        isActive
          ? 'rounded-t-xs bg-background text-foreground'
          : 'rounded-2xs text-foreground-secondary hover:bg-gray-500/10 hover:text-foreground'
      )}>
      <TabContent tab={tab} isActive={isActive} isDragging={isDragging} onClose={onClose} showClose={showClose} />
    </button>
  )
}

// 原生拖拽的固定 Tab 项
const DraggablePinnedTab = ({
  tab,
  isActive,
  onSelect,
  isDragging,
  onDragStart
}: {
  tab: Tab
  isActive: boolean
  onSelect: () => void
  isDragging: boolean
  onDragStart: (e: React.DragEvent, tab: Tab) => void
}) => {
  const fallback = tab.title.slice(0, 1).toUpperCase()

  return (
    <button
      draggable
      onDragStart={(e) => onDragStart(e, tab)}
      data-tab-id={tab.id}
      type="button"
      onClick={() => !isDragging && onSelect()}
      className={cn(
        'flex size-7 cursor-grab items-center justify-center rounded-[8px] p-1',
        isDragging && 'cursor-grabbing opacity-50',
        isActive ? 'hover:bg-background' : 'hover:bg-gray-500/10'
      )}
      title={tab.title}>
      <span className="flex size-5 items-center justify-center text-foreground/80">{tab.icon || fallback}</span>
    </button>
  )
}

// 插入指示器
const DropIndicator = ({ left }: { left: number }) => (
  <div
    className="pointer-events-none absolute top-0 z-50 h-full w-0.5 bg-primary"
    style={{ left: `${left}px`, transform: 'translateX(-50%)' }}
  />
)

export const AppShellTabBar = ({
  tabs,
  activeTabId,
  setActiveTab,
  closeTab,
  addTab,
  reorderTabs,
  detachTab,
  attachTab,
  isDetached = false
}: AppShellTabBarProps) => {
  const { homeTab, pinnedTabs, normalTabs } = useMemo(() => {
    const pinned: Tab[] = []
    const normal: Tab[] = []
    const home = tabs.find((tab) => tab.id === HOME_TAB_ID)
    for (const tab of tabs) {
      if (tab.id === HOME_TAB_ID) continue
      if (tab.isPinned) {
        pinned.push(tab)
      } else {
        normal.push(tab)
      }
    }
    return { homeTab: home, pinnedTabs: pinned, normalTabs: normal }
  }, [tabs])

  // 拖拽状态
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [currentDragId, setCurrentDragId] = useState<string | null>(null)
  const [isReceivingDrag, setIsReceivingDrag] = useState(false)
  const [insertIndicatorLeft, setInsertIndicatorLeft] = useState<number | null>(null)

  // Refs
  const tabBarRef = useRef<HTMLDivElement>(null)
  const normalTabsContainerRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  // 计算插入位置索引
  const calculateInsertIndex = useCallback(
    (clientX: number): number => {
      for (let i = 0; i < normalTabs.length; i++) {
        const el = tabRefs.current.get(normalTabs[i].id)
        if (el) {
          const rect = el.getBoundingClientRect()
          if (clientX < rect.left + rect.width / 2) {
            return i
          }
        }
      }
      return normalTabs.length
    },
    [normalTabs]
  )

  // 获取插入指示器的位置
  const getIndicatorLeft = useCallback(
    (insertIndex: number): number | null => {
      if (normalTabs.length === 0) {
        return normalTabsContainerRef.current?.getBoundingClientRect().left ?? null
      }

      if (insertIndex >= normalTabs.length) {
        // 插入到末尾
        const lastTab = tabRefs.current.get(normalTabs[normalTabs.length - 1].id)
        if (lastTab) {
          const rect = lastTab.getBoundingClientRect()
          return rect.right
        }
      } else {
        // 插入到某个 Tab 之前
        const targetTab = tabRefs.current.get(normalTabs[insertIndex].id)
        if (targetTab) {
          const rect = targetTab.getBoundingClientRect()
          return rect.left
        }
      }
      return null
    },
    [normalTabs]
  )

  // 拖拽开始 - 发送到 Main Process
  const handleDragStart = useCallback((e: React.DragEvent, tab: Tab) => {
    e.preventDefault() // 阻止默认行为，让 startDrag 接管

    setDraggedTabId(tab.id)

    // 发送到 Main Process，触发 startDrag
    window.electron.ipcRenderer.send(IpcChannel.Tab_DragStart, {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      type: tab.type,
      isPinned: tab.isPinned
    })
  }, [])

  // 拖拽结束
  const handleDragEnd = useCallback(() => {
    if (currentDragId) {
      window.electron.ipcRenderer.send(IpcChannel.Tab_DragEnd, currentDragId)
    }
    setDraggedTabId(null)
    setInsertIndicatorLeft(null)
    setCurrentDragId(null)
  }, [currentDragId])

  // 容器 DragOver - 计算插入位置
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'

      const insertIndex = calculateInsertIndex(e.clientX)
      const indicatorLeft = getIndicatorLeft(insertIndex)
      setInsertIndicatorLeft(indicatorLeft)
    },
    [calculateInsertIndex, getIndicatorLeft]
  )

  // DragLeave
  const handleDragLeave = useCallback(() => {
    setInsertIndicatorLeft(null)
  }, [])

  // Drop 处理
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()

      const insertIndex = calculateInsertIndex(e.clientX)

      // 通过 IPC 获取缓存的 Tab 数据
      if (currentDragId) {
        const tabData = await window.electron.ipcRenderer.invoke(IpcChannel.Tab_GetDragData, currentDragId)

        if (tabData) {
          // 判断是内部排序还是外部附加
          const existingTab = normalTabs.find((t) => t.id === tabData.id)
          if (existingTab) {
            // 内部排序
            const oldIndex = normalTabs.findIndex((t) => t.id === tabData.id)
            if (oldIndex !== insertIndex && oldIndex !== insertIndex - 1) {
              // 如果拖到自己后面，需要调整索引
              const adjustedNewIndex = oldIndex < insertIndex ? insertIndex - 1 : insertIndex
              reorderTabs('normal', oldIndex, adjustedNewIndex)
            }
          } else {
            // 外部附加
            attachTab?.(tabData)
          }
        }
      }

      setInsertIndicatorLeft(null)
      setIsReceivingDrag(false)
    },
    [calculateInsertIndex, currentDragId, normalTabs, reorderTabs, attachTab]
  )

  // 监听外部拖拽进入（从其他窗口）
  useEffect(() => {
    const handleExternalDragStart = (_: unknown, data: { dragId: string; tab: Tab }) => {
      setIsReceivingDrag(true)
      setCurrentDragId(data.dragId)
    }

    const handleExternalDragEnd = () => {
      setIsReceivingDrag(false)
      setInsertIndicatorLeft(null)
      setCurrentDragId(null)
      setDraggedTabId(null)
    }

    const removeStartListener = window.electron.ipcRenderer.on(IpcChannel.Tab_DragStart, handleExternalDragStart)
    const removeEndListener = window.electron.ipcRenderer.on(IpcChannel.Tab_DragEnd, handleExternalDragEnd)

    return () => {
      removeStartListener()
      removeEndListener()
    }
  }, [])

  // 处理本窗口发起的拖拽结束（dragend 事件）
  const handleLocalDragEnd = useCallback(
    (e: React.DragEvent) => {
      // 检测是否拖出 tabbar 边界（创建新窗口）
      const tabBarRect = tabBarRef.current?.getBoundingClientRect()
      if (tabBarRect && draggedTabId) {
        const isOutOfBounds = e.clientY < tabBarRect.top - 50 || e.clientY > tabBarRect.bottom + 50

        if (isOutOfBounds && e.dataTransfer.dropEffect !== 'move') {
          // 分离窗口模式：不创建新窗口，而是触发 attach
          if (isDetached) {
            const tab = normalTabs.find((t) => t.id === draggedTabId)
            if (tab && attachTab) {
              attachTab(tab)
            }
          } else {
            // 主窗口：触发 detach（拖出到新窗口）
            if (detachTab) {
              detachTab(draggedTabId)
            }
          }
        }
      }

      handleDragEnd()
    },
    [draggedTabId, normalTabs, isDetached, attachTab, detachTab, handleDragEnd]
  )

  const handleHomeClick = () => {
    if (homeTab) {
      setActiveTab(homeTab.id)
      return
    }

    addTab({
      id: HOME_TAB_ID,
      type: 'route',
      url: '/home',
      title: getDefaultRouteTitle('/home')
    })
  }

  const handleAddTab = () => {
    addTab({
      id: uuid(),
      type: 'route',
      url: '/',
      title: getDefaultRouteTitle('/')
    })
  }

  return (
    <header
      ref={tabBarRef}
      className={cn(
        'relative flex h-10 w-full items-center gap-[4px] bg-neutral-100 [-webkit-app-region:drag] dark:bg-neutral-900',
        isWin || isLinux ? 'pr-36' : 'pr-4',
        isMac ? 'pl-[env(titlebar-area-x)]' : 'pl-4',
        isReceivingDrag && 'ring-2 ring-primary/50 ring-inset'
      )}>
      {!isDetached && <HomeTab isActive={activeTabId === HOME_TAB_ID} onClick={handleHomeClick} />}

      {pinnedTabs.length > 0 && (
        <div className="flex shrink-0 items-center gap-[2px] rounded-[12px] border border-border px-[12px] py-[4px] [-webkit-app-region:no-drag]">
          {pinnedTabs.map((tab) => (
            <DraggablePinnedTab
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onSelect={() => setActiveTab(tab.id)}
              isDragging={draggedTabId === tab.id}
              onDragStart={handleDragStart}
            />
          ))}
        </div>
      )}

      <div
        ref={normalTabsContainerRef}
        className="relative flex h-full flex-1 flex-nowrap items-center gap-3 overflow-hidden"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}>
        {normalTabs.map((tab) => (
          <DraggableTabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onSelect={() => setActiveTab(tab.id)}
            onClose={() => closeTab(tab.id)}
            showClose={!isDetached}
            isDragging={draggedTabId === tab.id}
            onDragStart={handleDragStart}
            tabRef={(el) => {
              if (el) {
                tabRefs.current.set(tab.id, el)
              } else {
                tabRefs.current.delete(tab.id)
              }
            }}
          />
        ))}

        {/* 插入指示器 */}
        {insertIndicatorLeft !== null && <DropIndicator left={insertIndicatorLeft} />}

        {!isDetached && (
          <button
            type="button"
            onClick={handleAddTab}
            className="flex shrink-0 items-center justify-center p-[8px] [-webkit-app-region:no-drag] hover:bg-[rgba(107,114,128,0.1)]"
            title="New Tab">
            <Plus className="size-5" />
          </button>
        )}
      </div>

      {/* 全局 dragend 监听 */}
      <div
        className="pointer-events-none absolute inset-0"
        onDragEnd={handleLocalDragEnd}
        style={{ pointerEvents: draggedTabId ? 'auto' : 'none' }}
      />
    </header>
  )
}
