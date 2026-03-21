import { Input } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { AppLogo } from '@renderer/config/env'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { modelGenerating } from '@renderer/hooks/useModel'
import { useSettings } from '@renderer/hooks/useSettings'
import { getSidebarIconLabel } from '@renderer/i18n/label'
import { cn } from '@renderer/utils'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import {
  BarChart3,
  Code,
  Compass,
  FileSearch,
  Languages,
  LayoutGrid,
  MessageSquare,
  MousePointerClick,
  NotepadText,
  Palette,
  Search,
  Sparkle
} from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useTabs } from '../../hooks/useTabs'
import { OpenClawSidebarIcon } from '../Icons/SVGIcon'
import { SidebarOpenedMinappTabs, SidebarPinnedApps } from './PinnedMinapps'

const Sidebar: FC = () => {
  const { hideMinappPopup } = useMinappPopup()
  const { pinned, minappShow } = useMinapps()
  const [visibleSidebarIcons] = usePreference('ui.sidebar.icons.visible')
  const { tabs, activeTabId, updateTab } = useTabs()
  const [searchValue, setSearchValue] = useState('')
  const { t } = useTranslation()

  // Get current Tab's URL as pathname
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const pathname = activeTab?.url || '/'

  const showPinnedApps = pinned.length > 0 && visibleSidebarIcons.includes('minapp')

  // Navigate within current Tab
  const to = async (path: string) => {
    await modelGenerating()
    if (activeTabId) {
      updateTab(activeTabId, { url: path, title: getDefaultRouteTitle(path) })
    }
  }

  return (
    <div
      id="app-sidebar"
      className="flex h-full w-(--sidebar-width) min-w-(--sidebar-width) flex-col [-webkit-app-region:drag]">
      {/* Logo Area */}
      <div className="flex items-center gap-2 px-4 py-5 [-webkit-app-region:no-drag]">
        <img src={AppLogo} alt="Cherry Studio" className="h-9 w-9 rounded-lg" draggable={false} />
        <span className="font-semibold text-(--color-text-1) text-[15px]">Cherry Studio</span>
      </div>

      {/* Search Box */}
      <div className="mb-3 px-3 [-webkit-app-region:no-drag]">
        <div className="flex h-8 items-center gap-2 rounded-lg border border-(--color-border) px-2.5">
          <Search size={14} className="shrink-0 text-(--color-text-3)" />
          <Input
            placeholder={t('common.search')}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="h-full border-none bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
          />
        </div>
      </div>

      {/* Main Menu Area */}
      <div className="flex flex-1 flex-col overflow-hidden px-2">
        <nav className="flex flex-col [-webkit-app-region:no-drag]" onClick={hideMinappPopup}>
          <MainMenus pathname={pathname} minappShow={minappShow} onNavigate={to} />
        </nav>
        <SidebarOpenedMinappTabs />
        {showPinnedApps && (
          <div className="mt-2 flex flex-1 flex-col overflow-y-auto overflow-x-hidden [-webkit-app-region:no-drag] [&::-webkit-scrollbar]:hidden">
            <div className="my-2 border-(--color-border) border-b" />
            <nav className="flex flex-col">
              <SidebarPinnedApps />
            </nav>
          </div>
        )}
      </div>
    </div>
  )
}

interface SidebarMenuItemProps {
  icon: React.ReactNode
  label: string
  isActive?: boolean
  onClick?: () => void
}

const SidebarMenuItem: FC<SidebarMenuItemProps> = ({ icon, label, isActive, onClick }) => {
  return (
    <div
      onClick={onClick}
      className={cn(
        'relative flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-all [-webkit-app-region:no-drag]',
        isActive
          ? 'before:-translate-y-1/2 bg-[linear-gradient(90deg,var(--color-background-soft)_0%,var(--color-background-soft)_70%,rgba(0,185,107,0.15)_100%)] before:absolute before:top-1/2 before:left-0 before:h-1/2 before:w-0.75 before:rounded-r-sm before:bg-(--color-primary)'
          : 'hover:bg-(--color-background-soft)/50'
      )}>
      <span className={cn('shrink-0 text-(--color-text-2)', isActive && 'text-(--color-text-1)')}>{icon}</span>
      <span className={cn('text-[13px]', isActive ? 'font-medium text-(--color-text-1)' : 'text-(--color-text-2)')}>
        {label}
      </span>
    </div>
  )
}

interface MainMenusProps {
  pathname: string
  minappShow: boolean
  onNavigate: (path: string) => Promise<void>
}

const MainMenus: FC<MainMenusProps> = ({ pathname, minappShow, onNavigate }) => {
  const { hideMinappPopup } = useMinappPopup()
  const [visibleSidebarIcons] = usePreference('ui.sidebar.icons.visible')
  const { defaultPaintingProvider } = useSettings()

  const isRoutes = (path: string): boolean => pathname.startsWith(path) && path !== '/' && !minappShow

  const iconMap: Record<string, React.ReactNode> = {
    assistants: <MessageSquare size={18} strokeWidth={1.5} />,
    agents: <MousePointerClick size={18} strokeWidth={1.5} />,
    store: <Sparkle size={18} strokeWidth={1.5} />,
    paintings: <Palette size={18} strokeWidth={1.5} />,
    translate: <Languages size={18} strokeWidth={1.5} />,
    minapp: <LayoutGrid size={18} strokeWidth={1.5} />,
    knowledge: <FileSearch size={18} strokeWidth={1.5} />,
    files: <BarChart3 size={18} strokeWidth={1.5} />,
    notes: <NotepadText size={18} strokeWidth={1.5} />,
    code_tools: <Code size={18} strokeWidth={1.5} />,
    openclaw: <OpenClawSidebarIcon style={{ width: 18, height: 18 }} />,
    explore: <Compass size={18} strokeWidth={1.5} />
  }

  const pathMap: Record<string, string> = {
    assistants: '/app/chat',
    agents: '/app/agents',
    store: '/app/assistant',
    paintings: `/app/paintings/${defaultPaintingProvider}`,
    translate: '/app/translate',
    minapp: '/app/minapp',
    knowledge: '/app/knowledge',
    files: '/app/files',
    code_tools: '/app/code',
    notes: '/app/notes',
    openclaw: '/app/openclaw',
    explore: '/app/explore'
  }

  return (
    <>
      {visibleSidebarIcons.map((icon) => {
        const path = pathMap[icon]
        const isActive = isRoutes(path)

        return (
          <SidebarMenuItem
            key={icon}
            icon={iconMap[icon]}
            label={getSidebarIconLabel(icon)}
            isActive={isActive}
            onClick={async () => {
              hideMinappPopup()
              await onNavigate(path)
            }}
          />
        )
      })}
    </>
  )
}

export default Sidebar
