import { isLinux, isMac, isWin } from '@renderer/config/constant'
import { cn, uuid } from '@renderer/utils'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { Home, Plus, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo } from 'react'

import type { Tab } from '../../hooks/useTabs'

const HOME_TAB_ID = 'home'

type AppShellTabBarProps = {
  tabs: Tab[]
  activeTabId: string
  setActiveTab: (id: string) => void
  closeTab: (id: string) => void
  addTab: (tab: Tab) => void
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

const TabItem = ({
  tab,
  isActive,
  onSelect,
  onClose
}: {
  tab: Tab
  isActive: boolean
  onSelect: () => void
  onClose: () => void
}) => (
  <motion.button
    layout="position"
    transition={{ duration: 0.15, ease: 'linear' }}
    type="button"
    onClick={onSelect}
    className={cn(
      '@container group relative flex h-full min-w-[40px] max-w-[200px] flex-1 items-center gap-2 px-3 py-0.5 [-webkit-app-region:no-drag]',
      isActive
        ? 'rounded-t-xs bg-background text-foreground'
        : 'rounded-2xs text-foreground-secondary hover:bg-gray-500/10 hover:text-foreground'
    )}>
    {isActive && (
      <>
        <TabCornerLeft />
        <TabCornerRight />
      </>
    )}
    {/* Icon - inactive 始终显示，active 在 >=48px 时显示 */}
    <span
      className={cn(
        'flex size-5 shrink-0 items-center justify-center text-foreground/80',
        isActive && '@[48px]:flex hidden' // active 时 <48px 隐藏
      )}>
      {tab.icon || <Home className="size-5" />}
    </span>
    {/* 文案 - 默认隐藏，>=50px 显示 */}
    <span
      className="@[45px]:block hidden min-w-0 flex-1 whitespace-nowrap text-left font-medium text-sm leading-4"
      style={{ maskImage: 'linear-gradient(to right, black 80%, transparent 100%)' }}>
      {tab.title}
    </span>
    {/* Close icon - 只在 active 时显示 */}
    {isActive && (
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
  </motion.button>
)

const PinnedTabs = ({
  tabs,
  activeTabId,
  setActiveTab
}: {
  tabs: Tab[]
  activeTabId: string
  setActiveTab: (id: string) => void
}) => (
  <div className="flex shrink-0 items-center gap-[2px] rounded-[12px] border border-border px-[12px] py-[4px] [-webkit-app-region:no-drag]">
    {tabs.map((tab) => {
      const fallback = tab.title.slice(0, 1).toUpperCase()
      const isActive = tab.id === activeTabId

      return (
        <button
          key={tab.id}
          type="button"
          onClick={() => setActiveTab(tab.id)}
          className={cn(
            'flex size-7 items-center justify-center rounded-[8px] p-1',
            isActive ? 'hover:bg-background' : 'hover:bg-gray-500/10'
          )}
          title={tab.title}>
          <span className="flex size-5 items-center justify-center text-foreground/80">{tab.icon || fallback}</span>
        </button>
      )
    })}
  </div>
)

export const AppShellTabBar = ({ tabs, activeTabId, setActiveTab, closeTab, addTab }: AppShellTabBarProps) => {
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

  const handleHomeClick = () => {
    // TODO
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
    // TODO 新增的交互是一个窗口 而不是tab页
    addTab({
      id: uuid(),
      type: 'route',
      url: '/',
      title: getDefaultRouteTitle('/')
    })
  }

  return (
    <header
      className={cn(
        'flex h-10 w-full items-center gap-[4px] bg-neutral-100 [-webkit-app-region:drag] dark:bg-neutral-900',
        isWin || isLinux ? 'pr-36' : 'pr-4',
        isMac ? 'pl-[env(titlebar-area-x)]' : 'pl-4'
      )}>
      <HomeTab isActive={activeTabId === HOME_TAB_ID} onClick={handleHomeClick} />

      {pinnedTabs.length > 0 && <PinnedTabs tabs={pinnedTabs} activeTabId={activeTabId} setActiveTab={setActiveTab} />}

      <div className="flex h-full flex-1 flex-nowrap items-center gap-3 overflow-hidden">
        {normalTabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onSelect={() => setActiveTab(tab.id)}
            onClose={() => closeTab(tab.id)}
          />
        ))}
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
