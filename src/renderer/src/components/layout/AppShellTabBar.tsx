import type { DragEndEvent, DragStartEvent, UniqueIdentifier } from '@dnd-kit/core'
import { closestCenter, DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { isLinux, isMac, isWin } from '@renderer/config/constant'
import { cn, uuid } from '@renderer/utils'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { Home, Plus, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import type { Tab } from '../../hooks/useTabs'

const HOME_TAB_ID = 'home'

type AppShellTabBarProps = {
  tabs: Tab[]
  activeTabId: string
  setActiveTab: (id: string) => void
  closeTab: (id: string) => void
  addTab: (tab: Tab) => void
  reorderTabs: (type: 'pinned' | 'normal', oldIndex: number, newIndex: number) => void
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

// Tab 内容渲染（供 SortableTabItem 和 DragOverlay 复用）
const TabContent = ({
  tab,
  isActive,
  isDragging,
  onClose
}: {
  tab: Tab
  isActive: boolean
  isDragging?: boolean
  onClose?: () => void
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
    {isActive && onClose && !isDragging && (
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

const SortableTabItem = ({
  tab,
  isActive,
  onSelect,
  onClose
}: {
  tab: Tab
  isActive: boolean
  onSelect: () => void
  onClose: () => void
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1
  }

  return (
    <button
      ref={setNodeRef}
      style={style}
      data-tab-id={tab.id}
      {...attributes}
      {...listeners}
      type="button"
      onClick={() => !isDragging && onSelect()}
      className={cn(
        '@container group relative flex h-full min-w-[40px] max-w-[200px] flex-1 cursor-grab items-center gap-2 px-3 py-0.5 [-webkit-app-region:no-drag]',
        isDragging && 'cursor-grabbing',
        isActive
          ? 'rounded-t-xs bg-background text-foreground'
          : 'rounded-2xs text-foreground-secondary hover:bg-gray-500/10 hover:text-foreground'
      )}>
      <TabContent tab={tab} isActive={isActive} isDragging={isDragging} onClose={onClose} />
    </button>
  )
}

const SortablePinnedTab = ({ tab, isActive, onSelect }: { tab: Tab; isActive: boolean; onSelect: () => void }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id })
  const fallback = tab.title.slice(0, 1).toUpperCase()

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1
  }

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      type="button"
      onClick={() => !isDragging && onSelect()}
      className={cn(
        'flex size-7 cursor-grab items-center justify-center rounded-[8px] p-1',
        isDragging && 'cursor-grabbing',
        isActive ? 'hover:bg-background' : 'hover:bg-gray-500/10'
      )}
      title={tab.title}>
      <span className="flex size-5 items-center justify-center text-foreground/80">{tab.icon || fallback}</span>
    </button>
  )
}

const PinnedTabs = ({
  tabs,
  activeTabId,
  setActiveTab,
  onReorder
}: {
  tabs: Tab[]
  activeTabId: string
  setActiveTab: (id: string) => void
  onReorder: (oldIndex: number, newIndex: number) => void
}) => {
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)
  const activeTab = activeId ? tabs.find((t) => t.id === activeId) : null

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }
    })
  )

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = tabs.findIndex((t) => t.id === active.id)
      const newIndex = tabs.findIndex((t) => t.id === over.id)
      onReorder(oldIndex, newIndex)
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-[2px] rounded-[12px] border border-border px-[12px] py-[4px] [-webkit-app-region:no-drag]">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}>
        <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
          {tabs.map((tab) => (
            <SortablePinnedTab
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onSelect={() => setActiveTab(tab.id)}
            />
          ))}
        </SortableContext>
        <DragOverlay>
          {activeTab ? (
            <button
              type="button"
              className={cn(
                'flex size-7 cursor-grabbing items-center justify-center rounded-[8px] p-1',
                activeTab.id === activeTabId ? 'bg-background' : 'bg-gray-500/10'
              )}
              title={activeTab.title}>
              <span className="flex size-5 items-center justify-center text-foreground/80">
                {activeTab.icon || activeTab.title.slice(0, 1).toUpperCase()}
              </span>
            </button>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

export const AppShellTabBar = ({
  tabs,
  activeTabId,
  setActiveTab,
  closeTab,
  addTab,
  reorderTabs
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

  const [activeNormalTabId, setActiveNormalTabId] = useState<UniqueIdentifier | null>(null)
  const activeNormalTab = activeNormalTabId ? normalTabs.find((t) => t.id === activeNormalTabId) : null

  // 记录拖拽元素的宽度
  const draggedWidthRef = useRef<number>(0)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }
    })
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

  const handleNormalTabsDragStart = (event: DragStartEvent) => {
    setActiveNormalTabId(event.active.id)
    // 获取拖拽元素的实际宽度
    const element = document.querySelector(`[data-tab-id="${event.active.id}"]`)
    if (element) {
      draggedWidthRef.current = element.getBoundingClientRect().width
    }
  }

  const handleNormalTabsDragEnd = (event: DragEndEvent) => {
    setActiveNormalTabId(null)
    draggedWidthRef.current = 0
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = normalTabs.findIndex((t) => t.id === active.id)
      const newIndex = normalTabs.findIndex((t) => t.id === over.id)
      reorderTabs('normal', oldIndex, newIndex)
    }
  }

  return (
    <header
      className={cn(
        'flex h-10 w-full items-center gap-[4px] bg-neutral-100 [-webkit-app-region:drag] dark:bg-neutral-900',
        isWin || isLinux ? 'pr-36' : 'pr-4',
        isMac ? 'pl-[env(titlebar-area-x)]' : 'pl-4'
      )}>
      <HomeTab isActive={activeTabId === HOME_TAB_ID} onClick={handleHomeClick} />

      {pinnedTabs.length > 0 && (
        <PinnedTabs
          tabs={pinnedTabs}
          activeTabId={activeTabId}
          setActiveTab={setActiveTab}
          onReorder={(oldIndex, newIndex) => reorderTabs('pinned', oldIndex, newIndex)}
        />
      )}

      <div className="flex h-full flex-1 flex-nowrap items-center gap-3 overflow-hidden">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis]}
          onDragStart={handleNormalTabsDragStart}
          onDragEnd={handleNormalTabsDragEnd}>
          <SortableContext items={normalTabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
            {normalTabs.map((tab) => (
              <SortableTabItem
                key={tab.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                onSelect={() => setActiveTab(tab.id)}
                onClose={() => closeTab(tab.id)}
              />
            ))}
          </SortableContext>
          <DragOverlay>
            {activeNormalTab ? (
              <button
                type="button"
                style={{ width: draggedWidthRef.current || 'auto' }}
                className={cn(
                  '@container group relative flex h-full cursor-grabbing items-center gap-2 px-3 py-0.5',
                  activeNormalTab.id === activeTabId
                    ? 'rounded-t-xs bg-background text-foreground'
                    : 'rounded-2xs bg-gray-500/10 text-foreground-secondary'
                )}>
                <TabContent tab={activeNormalTab} isActive={activeNormalTab.id === activeTabId} isDragging />
              </button>
            ) : null}
          </DragOverlay>
        </DndContext>
        <button
          type="button"
          onClick={handleAddTab}
          className="flex shrink-0 items-center justify-center p-[8px] [-webkit-app-region:no-drag] hover:bg-[rgba(107,114,128,0.1)]"
          title="New Tab">
          <Plus className="size-5" />
        </button>
      </div>
    </header>
  )
}
