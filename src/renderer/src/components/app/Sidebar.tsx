import { usePersistCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { AppLogo } from '@renderer/config/env'
import { getMiniAppsLogo } from '@renderer/config/miniapps'
import useAvatar from '@renderer/hooks/useAvatar'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
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

import { useTabs } from '../../hooks/useTabs'
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
  mini_app: '/app/mini-app',
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
  mini_app: LayoutGrid,
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
  const [showOpenedInSidebar] = usePreference('feature.mini_app.show_opened_in_sidebar')
  const { activeTab, updateTab, openTab } = useTabs()
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
  const { openedKeepAliveMiniApps, currentMiniAppId, miniAppShow } = useMiniApps()
  const { openMiniAppKeepAlive } = useMiniAppPopup()

  const activeMiniAppTabs = useMemo<SidebarMiniAppTab[]>(() => {
    if (!showOpenedInSidebar) return []
    return openedKeepAliveMiniApps.map((app) => {
      // app.logo is a logo ID (e.g. 'Moonshot'); resolve to the CompoundIcon
      // when one exists, otherwise fall through to the raw string (URL for
      // custom mini-apps).
      const compound = getMiniAppsLogo(app.logo)
      const logo: SidebarMiniApp['logo'] = compound ?? app.logo
      return {
        type: 'miniapp',
        id: app.appId,
        title: app.name,
        miniApp: {
          id: app.appId,
          color: app.background,
          url: app.url,
          logo
        }
      }
    })
  }, [showOpenedInSidebar, openedKeepAliveMiniApps])

  const handleMiniAppTabClick = useCallback(
    (tabId: string) => {
      const app = openedKeepAliveMiniApps.find((a) => a.appId === tabId)
      if (!app) return
      // Switch the AppShell tab to this mini-app's route — openTab reuses an
      // existing tab when one matches the URL, so this also activates the
      // matching top-bar tab.
      openTab(`/app/mini-app/${app.appId}`, {
        title: app.nameKey ? t(app.nameKey) : app.name,
        icon: app.logo
      })
      openMiniAppKeepAlive(app)
    },
    [openedKeepAliveMiniApps, openMiniAppKeepAlive, openTab, t]
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
            ...(icon === 'mini_app' ? { miniAppTabs: activeMiniAppTabs } : {})
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
        openTab(path, { forceNew: true, title: getDefaultRouteTitle(path) })
        return
      }

      if (activeTab && activeTab.id !== 'home') {
        // Reusing the active tab — clear any per-entity icon (e.g. a mini-app
        // logo carried over from /app/mini-app/<id>) so the new top-level
        // route falls back to its default Lucide icon.
        updateTab(activeTab.id, { url: path, title: getDefaultRouteTitle(path), icon: undefined })
      } else {
        openTab(path, { forceNew: true, title: getDefaultRouteTitle(path) })
      }
    },
    [activeTab, updateTab, openTab, defaultPaintingProvider]
  )

  // Common props shared between normal and floating sidebar
  const sidebarProps = {
    activeItem,
    items,
    title: 'Cherry Studio',
    logo: APP_LOGO,
    user: sidebarUser,
    activeTabId: miniAppShow ? currentMiniAppId : undefined,
    dockedTabs: [],
    onItemClick: handleNavigate,
    onMiniAppTabClick: handleMiniAppTabClick,
    onCloseDockedTab: noop
  }

  return (
    <div ref={ref} id="app-sidebar" className="relative h-full [-webkit-app-region:no-drag]">
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
