import { Tooltip } from '@cherrystudio/ui'
import { isMac } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useFullscreen } from '@renderer/hooks/useFullscreen'
import { getThemeModeLabel } from '@renderer/i18n/label'
import { cn } from '@renderer/utils'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import {
  Code,
  Compass,
  FileSearch,
  Folder,
  Home,
  Languages,
  LayoutGrid,
  MessageSquare,
  Monitor,
  Moon,
  MousePointerClick,
  NotepadText,
  Palette,
  Plus,
  Settings,
  Sparkle,
  Sun,
  X
} from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { Tab } from '../../hooks/useTabs'

// Get icon based on URL path
const getTabIcon = (url: string): ReactNode => {
  const iconMap: Record<string, ReactNode> = {
    '/app/chat': <MessageSquare size={14} />,
    '/app/agents': <MousePointerClick size={14} />,
    '/app/assistant': <Sparkle size={14} />,
    '/app/paintings': <Palette size={14} />,
    '/app/translate': <Languages size={14} />,
    '/app/minapp': <LayoutGrid size={14} />,
    '/app/knowledge': <FileSearch size={14} />,
    '/app/files': <Folder size={14} />,
    '/app/notes': <NotepadText size={14} />,
    '/app/code': <Code size={14} />,
    '/app/explore': <Compass size={14} />
  }

  // Match path prefix
  for (const [path, icon] of Object.entries(iconMap)) {
    if (url.startsWith(path)) {
      return icon
    }
  }

  // Default icon
  return <MessageSquare size={14} />
}

interface TabItemProps {
  tab: Tab
  isActive: boolean
  canClose: boolean
  onSelect: () => void
  onClose: () => void
}

const TabItem: FC<TabItemProps> = ({ tab, isActive, canClose, onSelect, onClose }) => {
  return (
    <div
      onClick={onSelect}
      className={cn(
        'group flex h-8 cursor-pointer items-center gap-2 rounded-lg px-3 transition-colors',
        isActive
          ? 'bg-(--color-background-soft) text-(--color-text-1)'
          : 'text-(--color-text-2) hover:bg-(--color-background-soft)/50'
      )}>
      <span className={cn('shrink-0', tab.isDormant && 'opacity-50')}>{getTabIcon(tab.url)}</span>
      <span className={cn('max-w-25 truncate text-xs', tab.isDormant && 'opacity-50')}>{tab.title}</span>
      {canClose && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className={cn(
            'ml-0.5 shrink-0 rounded p-0.5 transition-opacity',
            isActive ? 'opacity-60 hover:opacity-100' : 'opacity-0 hover:opacity-100! group-hover:opacity-60'
          )}>
          <X size={12} />
        </button>
      )}
    </div>
  )
}

export interface AppHeaderProps {
  tabs: Tab[]
  activeTabId: string
  onTabSelect: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onAddTab: () => void
  onSettingsClick: () => void
}

export const AppHeader: FC<AppHeaderProps> = ({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onAddTab,
  onSettingsClick
}) => {
  const isFullscreen = useFullscreen()
  const { settedTheme, toggleTheme } = useTheme()
  const { t } = useTranslation()

  // Calculate TabBar padding-left for Mac titlebar compatibility
  const tabBarPaddingLeft = !isFullscreen && isMac ? 'calc(env(titlebar-area-x) + 4px)' : '12px'
  const tabBarPaddingRight = isFullscreen ? '12px' : '12px'
  const tabBarMinHeight = !isFullscreen && isMac ? 'env(titlebar-area-height)' : undefined

  return (
    <header
      className="flex h-(--navbar-height) w-full shrink-0 items-center gap-1.25 bg-(--color-background-mute) [-webkit-app-region:drag]"
      style={{
        paddingLeft: tabBarPaddingLeft,
        paddingRight: tabBarPaddingRight,
        minHeight: tabBarMinHeight
      }}>
      {/* Home Button */}
      <button
        type="button"
        onClick={onAddTab}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-(--color-text-2) transition-colors [-webkit-app-region:no-drag] hover:bg-(--color-background-soft)">
        <Home size={16} />
      </button>
      {/* Divider */}
      <div className="h-5 w-px bg-(--color-border) [-webkit-app-region:no-drag]" />
      {/* Tab List with Add Button */}
      <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [-webkit-app-region:drag] *:[-webkit-app-region:no-drag]">
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            canClose={tabs.length > 1}
            onSelect={() => onTabSelect(tab.id)}
            onClose={() => onTabClose(tab.id)}
          />
        ))}
        {/* Add Tab Button - follows last tab like Chrome */}
        <button
          type="button"
          onClick={onAddTab}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-(--color-text-2) transition-colors hover:bg-(--color-background-soft)"
          title="New Tab">
          <Plus size={16} />
        </button>
      </div>

      {/* Right Buttons: Theme Toggle & Settings */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5 pr-3 [-webkit-app-region:no-drag]">
        {/* Theme Toggle Button */}
        <Tooltip placement="bottom" content={t('settings.theme.title') + ': ' + getThemeModeLabel(settedTheme)}>
          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-text-1) transition-colors hover:bg-(--color-background-soft)">
            {settedTheme === ThemeMode.dark ? (
              <Moon size={16} />
            ) : settedTheme === ThemeMode.light ? (
              <Sun size={16} />
            ) : (
              <Monitor size={16} />
            )}
          </button>
        </Tooltip>

        {/* Settings Button */}
        <button
          type="button"
          onClick={onSettingsClick}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-text-1) transition-colors hover:bg-(--color-background-soft)">
          <Settings size={16} />
        </button>
      </div>
    </header>
  )
}
