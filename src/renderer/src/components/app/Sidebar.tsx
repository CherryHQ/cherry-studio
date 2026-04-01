import { usePersistCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { AppLogo } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import useAvatar from '@renderer/hooks/useAvatar'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { modelGenerating } from '@renderer/hooks/useModel'
import { useSettings } from '@renderer/hooks/useSettings'
import { getSidebarIconLabel } from '@renderer/i18n/label'
import { ThemeMode } from '@renderer/types'
import { isEmoji } from '@renderer/utils'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import type { SidebarIcon as SidebarIconType } from '@shared/data/preference/preferenceTypes'
import {
  Code,
  FileSearch,
  Folder,
  Languages,
  LayoutGrid,
  MessageSquare,
  Monitor,
  Moon,
  MousePointerClick,
  NotepadText,
  Palette,
  Puzzle,
  Settings,
  Sparkle,
  Sun
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useTabs } from '../../hooks/useTabs'
import { OpenClawSidebarIcon } from '../Icons/SVGIcon'
import UserPopup from '../Popups/UserPopup'
import { Sidebar as UISidebar } from '../Sidebar'
import { getSidebarLayout } from '../Sidebar/constants'
import { SidebarTooltip } from '../Sidebar/Tooltip'
import type { SidebarMenuItem, SidebarTab, SidebarUser } from '../Sidebar/types'

const routePrefixMap: Record<SidebarIconType, string> = {
  assistants: '/app/chat',
  agents: '/app/agents',
  store: '/app/assistant',
  paintings: '/app/paintings',
  translate: '/app/translate',
  minapp: '/app/minapp',
  knowledge: '/app/knowledge',
  files: '/app/files',
  code_tools: '/app/code',
  notes: '/app/notes',
  openclaw: '/app/openclaw'
}

const iconMap: Record<SidebarIconType, SidebarMenuItem['icon']> = {
  assistants: MessageSquare,
  agents: MousePointerClick,
  store: Sparkle,
  paintings: Palette,
  translate: Languages,
  minapp: LayoutGrid,
  knowledge: FileSearch,
  files: Folder,
  code_tools: Code,
  notes: NotepadText,
  openclaw: ({ size = 16 }) => <OpenClawSidebarIcon style={{ width: size, height: size }} />
}

function getMenuPath(icon: SidebarIconType, defaultPaintingProvider: string): string {
  if (icon === 'paintings') {
    return `/app/paintings/${defaultPaintingProvider}`
  }
  return routePrefixMap[icon] || ''
}

function resolveActiveItem(pathname: string): SidebarIconType | '' {
  const match = (Object.entries(routePrefixMap) as Array<[SidebarIconType, string]>).find(
    ([, prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
  return match?.[0] || ''
}

const Sidebar = () => {
  const [visibleSidebarIcons] = usePreference('ui.sidebar.icons.visible')
  const [showOpenedInSidebar] = usePreference('feature.minapp.show_opened_in_sidebar')
  const { activeTab, activeTabId, updateTab } = useTabs()
  const { defaultPaintingProvider } = useSettings()
  const { settedTheme, toggleTheme } = useTheme()

  // Sidebar width — persisted across restarts
  const [persistedWidth, setPersistedWidth] = usePersistCache('ui.sidebar.width')
  const [sidebarWidth, setSidebarWidth] = useState(persistedWidth)

  // Sync local width to CSS variable and persist cache
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`)
    setPersistedWidth(sidebarWidth)
  }, [sidebarWidth, setPersistedWidth])

  // User avatar
  const avatar = useAvatar()
  const sidebarUser = useMemo<SidebarUser>(
    () => ({
      name: 'User',
      email: '',
      avatarSrc: isEmoji(avatar) ? undefined : avatar || undefined,
      initial: isEmoji(avatar) ? avatar : undefined,
      onClick: () => UserPopup.show()
    }),
    [avatar]
  )

  // MiniApp tabs — bridge v1 popup system data to v2 sidebar UI
  const { openedKeepAliveMinapps, currentMinappId, minappShow } = useMinapps()
  const { openMinappKeepAlive } = useMinappPopup()

  const activeMiniAppTabs = useMemo<SidebarTab[]>(() => {
    if (!showOpenedInSidebar) return []
    return openedKeepAliveMinapps.map((app) => ({
      id: app.id,
      title: app.name,
      icon: Puzzle,
      miniAppId: app.id,
      miniAppColor: app.background,
      miniAppInitial: app.name?.[0],
      miniAppLogo: app.logo,
      miniAppLogoUrl: typeof app.logo === 'string' ? app.logo : undefined
    }))
  }, [showOpenedInSidebar, openedKeepAliveMinapps])

  const handleMiniAppTabClick = useCallback(
    (tabId: string) => {
      const app = openedKeepAliveMinapps.find((a) => a.id === tabId)
      if (app) {
        openMinappKeepAlive(app)
      }
    },
    [openedKeepAliveMinapps, openMinappKeepAlive]
  )

  // Floating sidebar (hover reveal when hidden)
  const [hoverVisible, setHoverVisible] = useState(false)
  const layout = getSidebarLayout(sidebarWidth)

  // Menu items
  const pathname = activeTab?.url || '/'

  const items = useMemo<SidebarMenuItem[]>(
    () =>
      visibleSidebarIcons.flatMap((icon) => {
        const path = getMenuPath(icon, defaultPaintingProvider)
        const Icon = iconMap[icon]
        if (!path || !Icon) {
          return []
        }
        return [{ id: icon, label: getSidebarIconLabel(icon), icon: Icon }]
      }),
    [defaultPaintingProvider, visibleSidebarIcons]
  )

  const activeItem = resolveActiveItem(pathname)

  const handleNavigate = async (menuItemId: string) => {
    const path = getMenuPath(menuItemId as SidebarIconType, defaultPaintingProvider)
    if (!path) return

    try {
      await modelGenerating()
    } catch {
      return
    }
    if (activeTabId) {
      updateTab(activeTabId, { url: path, title: getDefaultRouteTitle(path) })
    }
  }

  const handleSettingsClick = async () => {
    try {
      await modelGenerating()
    } catch {
      return
    }
    if (activeTabId) {
      updateTab(activeTabId, { url: '/settings/provider', title: getDefaultRouteTitle('/settings/provider') })
    }
  }

  // Theme icon
  const ThemeIcon = settedTheme === ThemeMode.dark ? Moon : settedTheme === ThemeMode.light ? Sun : Monitor

  // Bottom actions (theme toggle + settings) — will move to TabBar after PR #12474
  const bottomActions = (
    <>
      {layout === 'full' ? (
        <div className="flex items-center gap-1 px-2.5">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
            <ThemeIcon size={16} strokeWidth={1.6} />
          </button>
          <button
            type="button"
            onClick={handleSettingsClick}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
            <Settings size={16} strokeWidth={1.6} />
          </button>
        </div>
      ) : (
        <>
          <SidebarTooltip
            content={settedTheme === ThemeMode.dark ? 'Dark' : settedTheme === ThemeMode.light ? 'Light' : 'System'}>
            <button
              type="button"
              onClick={toggleTheme}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
              <ThemeIcon size={18} strokeWidth={1.6} />
            </button>
          </SidebarTooltip>
          <SidebarTooltip content="Settings">
            <button
              type="button"
              onClick={handleSettingsClick}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
              <Settings size={18} strokeWidth={1.6} />
            </button>
          </SidebarTooltip>
        </>
      )}
    </>
  )

  // Common props shared between normal and floating sidebar
  const sidebarProps = {
    activeItem,
    items,
    title: 'Cherry Studio',
    logo: <img src={AppLogo} alt="Cherry Studio" className="h-9 w-9 rounded-lg" draggable={false} />,
    user: sidebarUser,
    actions: bottomActions,
    activeMiniAppTabs,
    activeTabId: minappShow ? currentMinappId : undefined,
    onItemClick: handleNavigate,
    onMiniAppTabClick: handleMiniAppTabClick
  }

  return (
    <div id="app-sidebar" className="h-full [-webkit-app-region:no-drag]">
      <UISidebar width={sidebarWidth} setWidth={setSidebarWidth} onHoverChange={setHoverVisible} {...sidebarProps} />
      {hoverVisible && layout === 'hidden' && (
        <UISidebar
          width={sidebarWidth}
          setWidth={setSidebarWidth}
          isFloating
          onDismiss={() => setHoverVisible(false)}
          {...sidebarProps}
        />
      )}
    </div>
  )
}

export default Sidebar
