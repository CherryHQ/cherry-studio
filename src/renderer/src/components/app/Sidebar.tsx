import { usePersistCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { isMac } from '@renderer/config/constant'
import { AppLogo } from '@renderer/config/env'
import useAvatar from '@renderer/hooks/useAvatar'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { modelGenerating } from '@renderer/hooks/useModel'
import { useSettings } from '@renderer/hooks/useSettings'
import { getSidebarIconLabel } from '@renderer/i18n/label'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import type { SidebarIcon as SidebarIconType } from '@shared/data/preference/preferenceTypes'
import {
  Code,
  FileSearch,
  Folder,
  Languages,
  LayoutGrid,
  MessageSquare,
  MousePointerClick,
  NotepadText,
  Palette,
  Sparkle
} from 'lucide-react'
import type { Ref } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useActivePane } from '../../hooks/useActivePane'
import { usePanesActions } from '../../hooks/usePanes'
import { cn } from '../../utils'
import { OpenClawSidebarIcon } from '../Icons/SVGIcon'
import UserPopup from '../Popups/UserPopup'
import { Sidebar as UISidebar } from '../Sidebar'
import { getSidebarLayout } from '../Sidebar/constants'
import type { SidebarMenuItem, SidebarMiniApp, SidebarMiniAppTab, SidebarUser } from '../Sidebar/types'

const APP_LOGO = <img src={AppLogo} alt="Cherry Studio" className="h-9 w-9 rounded-lg" draggable={false} />
const noop = () => {}

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
  openclaw: OpenClawSidebarIcon
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

export default function Sidebar({ ref }: { ref?: Ref<HTMLDivElement | null> }) {
  const { t } = useTranslation()
  const [userName] = usePreference('app.user.name')
  const [visibleSidebarIcons] = usePreference('ui.sidebar.icons.visible')
  const [showOpenedInSidebar] = usePreference('feature.minapp.show_opened_in_sidebar')
  const { activePaneId, activeTab } = useActivePane()
  const { updateTab, openTabInActivePane } = usePanesActions()
  const { defaultPaintingProvider } = useSettings()

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
      name: userName || t('chat.user', { defaultValue: t('export.user', { defaultValue: 'User' }) }),
      avatar: avatar || undefined,
      onClick: () => UserPopup.show()
    }),
    [avatar, t, userName]
  )

  // MiniApp tabs — bridge v1 popup system data to v2 sidebar UI
  const { openedKeepAliveMinapps, currentMinappId, minappShow } = useMinapps()
  const { openMinappKeepAlive } = useMinappPopup()

  const activeMiniAppTabs = useMemo<SidebarMiniAppTab[]>(() => {
    if (!showOpenedInSidebar) return []
    return openedKeepAliveMinapps.map((app) => ({
      type: 'miniapp',
      id: app.id,
      title: app.name,
      miniApp: {
        id: app.id,
        color: app.background,
        url: app.url,
        logo: app.logo as SidebarMiniApp['logo']
      }
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
        return [
          {
            id: icon,
            label: getSidebarIconLabel(icon),
            icon: Icon,
            ...(icon === 'minapp' ? { miniAppTabs: activeMiniAppTabs } : {})
          }
        ]
      }),
    [defaultPaintingProvider, visibleSidebarIcons, activeMiniAppTabs]
  )

  const activeItem = resolveActiveItem(pathname)

  const handleNavigate = useCallback(
    async (menuItemId: string) => {
      const menuId = menuItemId as SidebarIconType
      const path = getMenuPath(menuId, defaultPaintingProvider)
      if (!path) return

      try {
        await modelGenerating()
      } catch {
        return
      }

      if (activeTab?.isPinned) {
        openTabInActivePane(path, { forceNew: true, title: getDefaultRouteTitle(path) })
        return
      }

      if (activeTab && activeTab.id !== 'home') {
        updateTab(activePaneId, activeTab.id, { url: path, title: getDefaultRouteTitle(path) })
      } else {
        openTabInActivePane(path, { forceNew: true, title: getDefaultRouteTitle(path) })
      }
    },
    [activeTab, activePaneId, updateTab, openTabInActivePane, defaultPaintingProvider]
  )

  // Common props shared between normal and floating sidebar
  const sidebarProps = {
    activeItem,
    items,
    title: 'Cherry Studio',
    logo: APP_LOGO,
    user: sidebarUser,
    activeTabId: minappShow ? currentMinappId : undefined,
    dockedTabs: [],
    onItemClick: handleNavigate,
    onMiniAppTabClick: handleMiniAppTabClick,
    onCloseDockedTab: noop
  }

  return (
    <div
      ref={ref}
      id="app-sidebar"
      className={cn('relative h-full [-webkit-app-region:no-drag]', isMac && 'pt-[38px]')}>
      {/* macOS traffic-light clearance: draggable strip above the sidebar content. */}
      {isMac && <div className="pointer-events-none absolute inset-x-0 top-0 h-[38px] [-webkit-app-region:drag]" />}
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
