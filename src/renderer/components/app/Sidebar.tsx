import { usePersistCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { SIDEBAR_ICON_COMPONENTS } from '@renderer/components/app/sidebarIcons'
import {
  emitResourceListReveal,
  type ResourceListRevealSource
} from '@renderer/components/chat/resources/resourceListRevealEvents'
import { useTabs } from '@renderer/hooks/tab'
import useAvatar from '@renderer/hooks/useAvatar'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { getSidebarIconLabelKey } from '@renderer/i18n/label'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import type { SidebarAppId } from '@renderer/utils/sidebar'
import {
  getOrderedVisibleSidebarFavorites,
  getSidebarMenuPath,
  getSidebarMiniAppFavoriteIds,
  resolveSidebarActiveItem
} from '@renderer/utils/sidebar'
import { clearTabInstanceMetadata } from '@renderer/utils/tabInstanceMetadata'
import type { Ref } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SidebarShellActions } from '../layout/ShellTabBarActions'
import UserPopup from '../Popups/UserPopup'
import { Sidebar as UISidebar } from '../Sidebar'
import { getSidebarDisplayWidth, getSidebarLayout, normalizeSidebarWidth } from '../Sidebar/constants'
import { UserAvatar } from '../Sidebar/primitives'
import type { SidebarMenuItem, SidebarMiniAppTab, SidebarUser, SidebarVisibleLayout } from '../Sidebar/types'

const MINI_APP_ROUTE_PREFIX = '/app/mini-app/'

function getResourceListRevealSource(menuItemId: SidebarAppId): ResourceListRevealSource | null {
  if (menuItemId === 'assistants' || menuItemId === 'agents') return menuItemId
  return null
}

function getMiniAppIdFromUrl(url: string | undefined): string | undefined {
  if (!url?.startsWith(MINI_APP_ROUTE_PREFIX)) return undefined
  const appId = url.slice(MINI_APP_ROUTE_PREFIX.length).split(/[/?#]/, 1)[0]
  return appId || undefined
}

export default function Sidebar({ ref }: { ref?: Ref<HTMLDivElement | null> }) {
  const { t } = useTranslation()
  const [userName] = usePreference('app.user.name')
  const [sidebarFavorites] = usePreference('ui.sidebar.favorites')
  const [sidebarMiniAppFavorites] = usePreference('ui.sidebar.mini_app_favorites')
  const { activeTab, updateTab, openTab } = useTabs()
  const { allApps } = useMiniApps()
  const [defaultPaintingProvider] = usePreference('feature.paintings.default_provider')

  // Sidebar width — persisted across restarts. Dragging through the
  // intermediate 50-120px range uses a local preview width so the UI can
  // follow the cursor without persisting unstable widths.
  const [sidebarWidth, setSidebarWidth] = usePersistCache('ui.sidebar.width')
  const [previewSidebarWidth, setPreviewSidebarWidth] = useState<number | null>(null)
  const activeSidebarWidth = previewSidebarWidth ?? sidebarWidth

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${getSidebarDisplayWidth(activeSidebarWidth)}px`)
  }, [activeSidebarWidth])

  // Migration, not dead code: the resize path only persists normalized widths,
  // but older builds (three-state layout, default 65) persisted intermediate
  // values that must be collapsed once on load. Writing derived state back
  // cannot loop — normalizeSidebarWidth is idempotent and the write is guarded
  // by the inequality check. Skip while a drag preview is active so the
  // write-back does not clobber it.
  useEffect(() => {
    if (previewSidebarWidth !== null) return

    const normalizedWidth = normalizeSidebarWidth(sidebarWidth)
    if (normalizedWidth !== sidebarWidth) {
      setSidebarWidth(normalizedWidth)
    }
  }, [previewSidebarWidth, setSidebarWidth, sidebarWidth])

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
  const sidebarLogo = useMemo(
    () => (
      <button
        type="button"
        aria-label={sidebarUser.name}
        onClick={sidebarUser.onClick}
        className="flex h-full w-full items-center justify-center rounded-full [-webkit-app-region:no-drag]">
        <UserAvatar user={sidebarUser} className="h-full w-full" ring={false} />
      </button>
    ),
    [sidebarUser]
  )

  // Floating sidebar (hover reveal when hidden)
  const [hoverVisible, setHoverVisible] = useState(false)
  const layout = getSidebarLayout(activeSidebarWidth)

  // Menu items
  const pathname = activeTab?.url || '/'
  const activeMiniAppId = getMiniAppIdFromUrl(activeTab?.url)
  const sidebarMiniAppFavoriteIds = useMemo(
    () => getSidebarMiniAppFavoriteIds(sidebarMiniAppFavorites),
    [sidebarMiniAppFavorites]
  )

  const sidebarMiniAppTabs = useMemo<SidebarMiniAppTab[]>(() => {
    const appById = new Map(allApps.map((app) => [app.appId, app]))

    return sidebarMiniAppFavoriteIds.flatMap((appId) => {
      const app = appById.get(appId)
      if (!app) return []

      return [
        {
          id: app.appId,
          title: app.nameKey ? t(app.nameKey) : app.name,
          type: 'miniapp',
          miniApp: {
            id: app.appId,
            logo: app.logo,
            url: app.url
          }
        }
      ]
    })
  }, [allApps, sidebarMiniAppFavoriteIds, t])

  const items = useMemo<SidebarMenuItem[]>(
    () =>
      getOrderedVisibleSidebarFavorites(sidebarFavorites).flatMap((icon) => {
        const path = getSidebarMenuPath(icon, defaultPaintingProvider)
        const Icon = SIDEBAR_ICON_COMPONENTS[icon]
        if (!path || !Icon) {
          return []
        }
        return [
          {
            id: icon,
            label: t(getSidebarIconLabelKey(icon)),
            icon: Icon
          }
        ]
      }),
    [defaultPaintingProvider, sidebarFavorites, t]
  )

  const activeItem = resolveSidebarActiveItem(pathname)

  const handleNavigate = useCallback(
    (menuItemId: string) => {
      const menuId = menuItemId as SidebarAppId
      const path = getSidebarMenuPath(menuId, defaultPaintingProvider)
      if (!path || activeTab?.url === path) return

      const title = getDefaultRouteTitle(path)
      const revealSource = getResourceListRevealSource(menuId)

      if (activeTab?.isPinned) {
        const openedId = openTab(path, { forceNew: true, title })
        if (revealSource) {
          emitResourceListReveal({ source: revealSource, tabId: openedId })
        }
        return
      }

      if (activeTab) {
        updateTab(activeTab.id, {
          url: path,
          title,
          icon: undefined,
          metadata: clearTabInstanceMetadata(activeTab.metadata)
        })
        if (revealSource) {
          emitResourceListReveal({ source: revealSource, tabId: activeTab.id })
        }
        return
      }

      const openedId = openTab(path, { forceNew: true, title })
      if (revealSource) {
        emitResourceListReveal({ source: revealSource, tabId: openedId })
      }
    },
    [activeTab, updateTab, openTab, defaultPaintingProvider]
  )
  const handleOpenSettingsTab = useCallback(() => {
    openTab('/settings/provider', { title: t('settings.title') })
  }, [openTab, t])

  const handleOpenMiniAppTab = useCallback(
    (appId: string) => {
      const app = allApps.find((item) => item.appId === appId)
      if (!app) return

      openTab(`${MINI_APP_ROUTE_PREFIX}${app.appId}`, {
        title: app.nameKey ? t(app.nameKey) : app.name,
        icon: app.logo
      })
    },
    [allApps, openTab, t]
  )

  // Common props shared between normal and floating sidebar
  const sidebarProps = {
    activeItem,
    activeTabId: activeMiniAppId,
    items,
    title: sidebarUser.name,
    logo: sidebarLogo,
    actions: (footerLayout: SidebarVisibleLayout) => (
      <SidebarShellActions layout={footerLayout} onSettingsClick={handleOpenSettingsTab} />
    ),
    dockedTabs: sidebarMiniAppTabs,
    onItemClick: handleNavigate,
    onMiniAppTabClick: handleOpenMiniAppTab
  }

  return (
    <div ref={ref} id="app-sidebar" className="relative h-full [-webkit-app-region:no-drag]">
      <UISidebar
        width={activeSidebarWidth}
        setWidth={setSidebarWidth}
        onHoverChange={setHoverVisible}
        onResizePreview={setPreviewSidebarWidth}
        {...sidebarProps}
      />
      {hoverVisible && layout === 'hidden' && (
        <UISidebar
          width={activeSidebarWidth}
          setWidth={setSidebarWidth}
          isFloating
          onDismiss={() => setHoverVisible(false)}
          {...sidebarProps}
        />
      )}
    </div>
  )
}
