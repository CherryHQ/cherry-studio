import { isLinux, isMac, isWin } from '@renderer/config/constant'
import { cn, uuid } from '@renderer/utils'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { IpcChannel } from '@shared/IpcChannel'
import { Home, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Tab } from '../../hooks/useTabs'

const HOME_TAB_ID = 'home'
const DRAG_THRESHOLD = 5
const DETACH_THRESHOLD = 30
const TAB_GAP = 12

type DragMode = 'pending' | 'reorder' | 'detach'

type AppShellTabBarProps = {
  tabs: Tab[]
  activeTabId: string
  setActiveTab: (id: string) => void
  closeTab: (id: string) => void
  addTab: (tab: Tab) => void
  reorderTabs: (type: 'pinned' | 'normal', oldIndex: number, newIndex: number) => void
  detachTab?: (tabId: string) => void
  attachTab?: (tab: Tab) => void
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

const TabItem = ({
  tab,
  isActive,
  onSelect,
  onClose,
  showClose = true,
  isDragging,
  isGhost,
  noTransition,
  translateX,
  onPointerDown,
  tabRef
}: {
  tab: Tab
  isActive: boolean
  onSelect: () => void
  onClose: () => void
  showClose?: boolean
  isDragging: boolean
  isGhost: boolean
  noTransition: boolean
  translateX: number
  onPointerDown: (e: React.PointerEvent) => void
  tabRef: (el: HTMLButtonElement | null) => void
}) => {
  return (
    <button
      ref={tabRef}
      data-tab-id={tab.id}
      type="button"
      onPointerDown={onPointerDown}
      onClick={onSelect}
      style={{
        transform: `translateX(${translateX}px)`,
        transition: isDragging || noTransition ? 'none' : 'transform 200ms ease',
        zIndex: isDragging ? 50 : 'auto',
        opacity: isGhost ? 0.3 : 1
      }}
      className={cn(
        '@container group relative flex h-full min-w-[40px] max-w-[200px] flex-1 items-center gap-2 px-3 py-0.5 [-webkit-app-region:no-drag]',
        isDragging ? 'cursor-grabbing' : 'cursor-grab',
        isActive
          ? 'rounded-t-xs bg-background text-foreground'
          : 'rounded-2xs text-foreground-secondary hover:bg-gray-500/10 hover:text-foreground'
      )}>
      <TabContent tab={tab} isActive={isActive} isDragging={isDragging} onClose={onClose} showClose={showClose} />
    </button>
  )
}

const PinnedTab = ({
  tab,
  isActive,
  onSelect,
  isDragging,
  isGhost,
  noTransition,
  translateX,
  onPointerDown
}: {
  tab: Tab
  isActive: boolean
  onSelect: () => void
  isDragging: boolean
  isGhost: boolean
  noTransition: boolean
  translateX: number
  onPointerDown: (e: React.PointerEvent) => void
}) => {
  const fallback = tab.title.slice(0, 1).toUpperCase()

  return (
    <button
      data-tab-id={tab.id}
      type="button"
      onPointerDown={onPointerDown}
      onClick={onSelect}
      style={{
        transform: `translateX(${translateX}px)`,
        transition: isDragging || noTransition ? 'none' : 'transform 200ms ease',
        zIndex: isDragging ? 50 : 'auto',
        opacity: isGhost ? 0.3 : 1
      }}
      className={cn(
        'flex size-7 items-center justify-center rounded-[8px] p-1',
        isDragging ? 'cursor-grabbing' : 'cursor-grab',
        isActive ? 'hover:bg-background' : 'hover:bg-gray-500/10'
      )}
      title={tab.title}>
      <span className="flex size-5 items-center justify-center text-foreground/80">{tab.icon || fallback}</span>
    </button>
  )
}

export const AppShellTabBar = ({
  tabs,
  activeTabId,
  setActiveTab,
  closeTab,
  addTab,
  reorderTabs,
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

  // 拖拽渲染状态
  const [dragState, setDragState] = useState<{
    tabId: string
    mode: DragMode
    insertIndex: number
  } | null>(null)

  // 防止 reorder 后动画闪烁（禁用一帧 transition）
  const [settling, setSettling] = useState(false)

  // 高频变化数据（不触发渲染）
  const dragRef = useRef({
    pointerId: 0,
    startX: 0,
    startY: 0,
    currentX: 0,
    tabType: 'normal' as 'pinned' | 'normal',
    detachedCreated: false,
    tabClosed: false,
    originalRects: new Map<string, { left: number; width: number }>(),
    grabOffsetX: 0,
    grabOffsetY: 0
  })

  // 防止拖拽结束后触发 onClick
  const didDragRef = useRef(false)

  const tabBarRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const rafId = useRef<number | null>(null)

  // settling 恢复
  useEffect(() => {
    if (settling) {
      const id = requestAnimationFrame(() => setSettling(false))
      return () => cancelAnimationFrame(id)
    }
    return undefined
  }, [settling])

  // 用原始位置计算插入索引（跳过被拖拽的 tab）
  const calculateInsertIndex = useCallback(
    (clientX: number, dragTabId: string): number => {
      const list = dragRef.current.tabType === 'pinned' ? pinnedTabs : normalTabs
      const rects = dragRef.current.originalRects
      for (let i = 0; i < list.length; i++) {
        if (list[i].id === dragTabId) continue
        const rect = rects.get(list[i].id)
        if (rect) {
          if (clientX < rect.left + rect.width / 2) {
            return i
          }
        }
      }
      return list.length
    },
    [normalTabs, pinnedTabs]
  )

  // 计算每个 tab 的 translateX
  const getTranslateX = useCallback(
    (tabId: string, tabType: 'pinned' | 'normal'): number => {
      if (!dragState || dragState.mode !== 'reorder' || dragRef.current.tabType !== tabType) return 0

      const list = tabType === 'pinned' ? pinnedTabs : normalTabs
      const draggedIndex = list.findIndex((t) => t.id === dragState.tabId)
      const currentIndex = list.findIndex((t) => t.id === tabId)
      const { insertIndex } = dragState

      if (tabId === dragState.tabId) {
        return dragRef.current.currentX - dragRef.current.startX
      }

      const draggedRect = dragRef.current.originalRects.get(dragState.tabId)
      if (!draggedRect) return 0
      const draggedWidth = draggedRect.width + TAB_GAP

      if (draggedIndex < insertIndex) {
        if (currentIndex > draggedIndex && currentIndex < insertIndex) {
          return -draggedWidth
        }
      } else if (draggedIndex > insertIndex) {
        if (currentIndex >= insertIndex && currentIndex < draggedIndex) {
          return draggedWidth
        }
      }

      return 0
    },
    [dragState, pinnedTabs, normalTabs]
  )

  // pointerdown
  const handlePointerDown = useCallback(
    (e: React.PointerEvent, tab: Tab, tabType: 'pinned' | 'normal') => {
      if (e.button !== 0) return
      if ((e.target as HTMLElement).closest('[role="button"]')) return

      const target = e.currentTarget as HTMLElement
      target.setPointerCapture(e.pointerId)

      const list = tabType === 'pinned' ? pinnedTabs : normalTabs
      const index = list.findIndex((t) => t.id === tab.id)

      // 存储所有 tab 的原始位置
      const originalRects = new Map<string, { left: number; width: number }>()
      for (const t of list) {
        const el = tabRefs.current.get(t.id)
        if (el) {
          const rect = el.getBoundingClientRect()
          originalRects.set(t.id, { left: rect.left, width: rect.width })
        }
      }

      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        tabType,
        detachedCreated: false,
        tabClosed: false,
        originalRects,
        grabOffsetX: e.screenX - window.screenX,
        grabOffsetY: e.screenY - window.screenY
      }

      didDragRef.current = false

      setDragState({
        tabId: tab.id,
        mode: 'pending',
        insertIndex: index
      })
    },
    [pinnedTabs, normalTabs]
  )

  // onClick 防抖：拖拽结束后不触发选中
  const handleTabClick = useCallback(
    (tabId: string) => {
      if (didDragRef.current) {
        didDragRef.current = false
        return
      }
      setActiveTab(tabId)
    },
    [setActiveTab]
  )

  // document 级别的 pointermove / pointerup
  useEffect(() => {
    if (!dragState) return

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== dragRef.current.pointerId) return

      dragRef.current.currentX = e.clientX
      const deltaX = e.clientX - dragRef.current.startX
      const deltaY = e.clientY - dragRef.current.startY

      // 分离窗口：拖 tab = 拖整个窗口
      if (isDetached) {
        const pastThreshold = Math.abs(deltaX) > DRAG_THRESHOLD || Math.abs(deltaY) > DRAG_THRESHOLD
        if (dragState.mode === 'pending' && pastThreshold) {
          setDragState((prev) => (prev ? { ...prev, mode: 'detach' } : null))
        }
        // 用 pastThreshold 兜底，避免闭包中 mode 仍为 pending 导致首帧丢失
        if (dragState.mode === 'detach' || pastThreshold) {
          if (rafId.current === null) {
            rafId.current = requestAnimationFrame(() => {
              window.electron.ipcRenderer.send(IpcChannel.Tab_MoveWindow, {
                tabId: dragState.tabId,
                x: e.screenX - dragRef.current.grabOffsetX,
                y: e.screenY - dragRef.current.grabOffsetY
              })
              rafId.current = null
            })
          }
        }
        return
      }

      // 主窗口逻辑
      const tabBarRect = tabBarRef.current?.getBoundingClientRect()
      if (!tabBarRect) return

      const isOutsideTabBar =
        e.clientY < tabBarRect.top - DETACH_THRESHOLD || e.clientY > tabBarRect.bottom + DETACH_THRESHOLD

      if (dragState.mode === 'pending') {
        if (isOutsideTabBar && Math.abs(deltaY) > DETACH_THRESHOLD) {
          setDragState((prev) => (prev ? { ...prev, mode: 'detach' } : null))
        } else if (Math.abs(deltaX) > DRAG_THRESHOLD) {
          setDragState((prev) => (prev ? { ...prev, mode: 'reorder' } : null))
        }
      } else if (dragState.mode === 'reorder') {
        if (isOutsideTabBar) {
          setDragState((prev) => (prev ? { ...prev, mode: 'detach' } : null))
        } else {
          if (rafId.current === null) {
            rafId.current = requestAnimationFrame(() => {
              const newInsertIndex = calculateInsertIndex(dragRef.current.currentX, dragState.tabId)
              setDragState((prev) => (prev ? { ...prev, insertIndex: newInsertIndex } : null))
              rafId.current = null
            })
          }
        }
      }

      // 分离模式：创建/移动窗口
      if (dragState.mode === 'detach' || (isOutsideTabBar && Math.abs(deltaY) > DETACH_THRESHOLD)) {
        if (!dragRef.current.detachedCreated) {
          const allTabs = [...pinnedTabs, ...normalTabs]
          const tab = allTabs.find((t) => t.id === dragState.tabId)
          if (tab) {
            window.electron.ipcRenderer.send(IpcChannel.Tab_Detach, {
              ...tab,
              x: e.screenX - 400,
              y: e.screenY - 20
            })
            dragRef.current.detachedCreated = true
            closeTab(dragState.tabId)
            dragRef.current.tabClosed = true
            didDragRef.current = true
          }
        } else if (!dragRef.current.tabClosed) {
          // tab 已被 closeTab 卸载，仅在未关闭时更新排序等状态
        } else {
          // tab 已关闭，只需移动新窗口
          if (rafId.current === null) {
            rafId.current = requestAnimationFrame(() => {
              window.electron.ipcRenderer.send(IpcChannel.Tab_MoveWindow, {
                tabId: dragState.tabId,
                x: e.screenX - 400,
                y: e.screenY - 20
              })
              rafId.current = null
            })
          }
        }
      }
    }

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== dragRef.current.pointerId) return

      const el = tabRefs.current.get(dragState.tabId)
      if (el) {
        try {
          el.releasePointerCapture(dragRef.current.pointerId)
        } catch {
          // 元素可能已卸载
        }
      }

      // 分离窗口：松手时尝试附回主窗口
      if (isDetached && dragState.mode === 'detach') {
        didDragRef.current = true
        const allTabs = [...pinnedTabs, ...normalTabs]
        const tab = allTabs.find((t) => t.id === dragState.tabId)
        if (tab) {
          window.electron.ipcRenderer
            .invoke(IpcChannel.Tab_TryAttach, {
              tab,
              screenX: e.screenX,
              screenY: e.screenY
            })
            .catch(() => {
              // 主窗口不可用，窗口保持分离状态
            })
        }
        setDragState(null)
        if (rafId.current !== null) {
          cancelAnimationFrame(rafId.current)
          rafId.current = null
        }
        return
      }

      if (dragState.mode === 'reorder') {
        didDragRef.current = true
        const list = dragRef.current.tabType === 'pinned' ? pinnedTabs : normalTabs
        const oldIndex = list.findIndex((t) => t.id === dragState.tabId)
        if (oldIndex !== -1 && oldIndex !== dragState.insertIndex) {
          const adjustedIndex = oldIndex < dragState.insertIndex ? dragState.insertIndex - 1 : dragState.insertIndex
          if (oldIndex !== adjustedIndex) {
            setSettling(true)
            reorderTabs(dragRef.current.tabType, oldIndex, adjustedIndex)
          }
        }
      } else if (dragState.mode === 'detach') {
        if (!dragRef.current.tabClosed && dragRef.current.tabType === 'normal') {
          closeTab(dragState.tabId)
        }
        window.electron.ipcRenderer.send(IpcChannel.Tab_DragEnd)
      }

      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current)
        rafId.current = null
      }
      setDragState(null)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)

    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
  }, [dragState, pinnedTabs, normalTabs, calculateInsertIndex, reorderTabs, closeTab, isDetached])

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

  const noTransition = settling

  return (
    <header
      ref={tabBarRef}
      className={cn(
        'relative flex h-10 w-full items-center gap-[4px] bg-neutral-100 [-webkit-app-region:drag] dark:bg-neutral-900',
        isWin || isLinux ? 'pr-36' : 'pr-4',
        isMac ? 'pl-[env(titlebar-area-x)]' : 'pl-4'
      )}>
      {!isDetached && <HomeTab isActive={activeTabId === HOME_TAB_ID} onClick={handleHomeClick} />}

      {pinnedTabs.length > 0 && (
        <div className="flex shrink-0 items-center gap-[2px] rounded-[12px] border border-border px-[12px] py-[4px] [-webkit-app-region:no-drag]">
          {pinnedTabs.map((tab) => (
            <PinnedTab
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onSelect={() => handleTabClick(tab.id)}
              isDragging={dragState?.tabId === tab.id && dragState?.mode === 'reorder'}
              isGhost={dragState?.tabId === tab.id && dragState?.mode === 'detach'}
              noTransition={noTransition}
              translateX={getTranslateX(tab.id, 'pinned')}
              onPointerDown={(e) => handlePointerDown(e, tab, 'pinned')}
            />
          ))}
        </div>
      )}

      <div className="relative flex h-full flex-1 flex-nowrap items-center gap-3 overflow-hidden">
        {normalTabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onSelect={() => handleTabClick(tab.id)}
            onClose={() => closeTab(tab.id)}
            showClose={!isDetached}
            isDragging={dragState?.tabId === tab.id && dragState?.mode === 'reorder'}
            isGhost={dragState?.tabId === tab.id && dragState?.mode === 'detach'}
            noTransition={noTransition}
            translateX={getTranslateX(tab.id, 'normal')}
            onPointerDown={(e) => handlePointerDown(e, tab, 'normal')}
            tabRef={(el) => {
              if (el) {
                tabRefs.current.set(tab.id, el)
              } else {
                tabRefs.current.delete(tab.id)
              }
            }}
          />
        ))}

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
    </header>
  )
}
