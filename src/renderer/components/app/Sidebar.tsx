import { usePersistCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import {
  emitResourceListReveal,
  type ResourceListRevealSource
} from '@renderer/components/chat/resources/resourceListRevealEvents'
import { AppLogo } from '@renderer/config/env'
import {
  findAppTabToFocus,
  getOrderedVisibleSidebarIcons,
  getSidebarApp,
  getSidebarMenuPath,
  resolveSidebarActiveItem,
  SIDEBAR_ICON_COMPONENTS
} from '@renderer/config/sidebar'
import { clearTabInstanceMetadata } from '@renderer/config/tabInstanceMetadata'
import useAvatar from '@renderer/hooks/useAvatar'
import { useSettings } from '@renderer/hooks/useSettings'
import { useTabs } from '@renderer/hooks/useTabs'
import { getSidebarIconLabel } from '@renderer/i18n/label'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import type { SidebarIcon as SidebarIconType } from '@shared/data/preference/preferenceTypes'
import type { Ref } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import UserPopup from '../Popups/UserPopup'
import { Sidebar as UISidebar } from '../Sidebar'
import { getSidebarLayout } from '../Sidebar/constants'
import type { SidebarMenuItem, SidebarUser } from '../Sidebar/types'

const APP_LOGO = <img src={AppLogo} alt="Cherry Studio" className="h-9 w-9 rounded-lg" draggable={false} />
const noop = () => {}
const FLOATING_SIDEBAR_EXIT_MS = 200
type FloatingSidebarState = 'closed' | 'open' | 'closing'

function getResourceListRevealSource(menuItemId: SidebarIconType): ResourceListRevealSource | null {
  if (menuItemId === 'assistants' || menuItemId === 'agents') return menuItemId
  return null
}

export default function Sidebar({ ref }: { ref?: Ref<HTMLDivElement | null> }) {
  const { t } = useTranslation()
  const [userName] = usePreference('app.user.name')
  const [visibleSidebarIcons] = usePreference('ui.sidebar.icons.visible')
  const { activeTab, tabs, updateTab, openTab, setActiveTab } = useTabs()
  const { defaultPaintingProvider } = useSettings()

  // Sidebar width — persisted across restarts. Drive the CSS variable
  // straight from the cached value so:
  //   (1) cross-window updates flow without a local-state mirror
  //   (2) the resize handler writes to the cache directly (event-handler
  //       semantics) instead of via an effect on derived state, which
  //       would loop on revalidation per the SWR write-back antipattern.
  const [sidebarWidth, setSidebarWidth] = usePersistCache('ui.sidebar.width')

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`)
  }, [sidebarWidth])

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

  // Floating sidebar (hover reveal when hidden)
  const [floatingSidebarState, setFloatingSidebarState] = useState<FloatingSidebarState>('closed')
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const layout = getSidebarLayout(sidebarWidth)
  const hoverVisible = floatingSidebarState !== 'closed'
  const hoverClosing = floatingSidebarState === 'closing'

  const clearHoverCloseTimer = useCallback(() => {
    if (!hoverCloseTimerRef.current) return
    clearTimeout(hoverCloseTimerRef.current)
    hoverCloseTimerRef.current = null
  }, [])

  const setFloatingSidebarVisible = useCallback(
    (visible: boolean) => {
      if (visible) {
        clearHoverCloseTimer()
        setFloatingSidebarState('open')
        return
      }

      if (floatingSidebarState !== 'open') return

      setFloatingSidebarState('closing')
      hoverCloseTimerRef.current = setTimeout(() => {
        setFloatingSidebarState('closed')
        hoverCloseTimerRef.current = null
      }, FLOATING_SIDEBAR_EXIT_MS)
    },
    [clearHoverCloseTimer, floatingSidebarState]
  )

  useEffect(() => clearHoverCloseTimer, [clearHoverCloseTimer])

  // Menu items
  const pathname = activeTab?.url || '/'

  const items = useMemo<SidebarMenuItem[]>(
    () =>
      getOrderedVisibleSidebarIcons(visibleSidebarIcons).flatMap((icon) => {
        const path = getSidebarMenuPath(icon, defaultPaintingProvider)
        const Icon = SIDEBAR_ICON_COMPONENTS[icon]
        if (!path || !Icon) {
          return []
        }
        return [
          {
            id: icon,
            label: getSidebarIconLabel(icon),
            icon: Icon
          }
        ]
      }),
    [defaultPaintingProvider, visibleSidebarIcons]
  )

  const activeItem = resolveSidebarActiveItem(pathname)

  const handleNavigate = useCallback(
    (menuItemId: string) => {
      const menuId = menuItemId as SidebarIconType
      const path = getSidebarMenuPath(menuId, defaultPaintingProvider)
      if (!path || activeTab?.url === path) return

      const title = getDefaultRouteTitle(path)
      const revealSource = getResourceListRevealSource(menuId)

      // Uniqueness: if a tab for this app already exists, focus it instead of
      // duplicating it (or clobbering the active tab into a second copy). Only
      // fall through to reuse-active / open when no tab for the app exists yet.
      const app = getSidebarApp(menuId)
      const existingId = app ? findAppTabToFocus(app, tabs, { defaultPaintingProvider }) : undefined
      if (existingId) {
        if (existingId !== activeTab?.id) {
          setActiveTab(existingId)
        }
        if (revealSource) {
          emitResourceListReveal({ source: revealSource, tabId: existingId })
        }
        return
      }

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
    [activeTab, tabs, updateTab, openTab, setActiveTab, defaultPaintingProvider]
  )

  // Common props shared between normal and floating sidebar
  const sidebarProps = {
    activeItem,
    items,
    title: 'Cherry Studio',
    logo: APP_LOGO,
    user: sidebarUser,
    dockedTabs: [],
    onItemClick: handleNavigate,
    onCloseDockedTab: noop
  }

  return (
    <div ref={ref} id="app-sidebar" className="relative h-full [-webkit-app-region:no-drag]">
      <UISidebar
        width={sidebarWidth}
        setWidth={setSidebarWidth}
        onHoverChange={setFloatingSidebarVisible}
        {...sidebarProps}
      />
      {hoverVisible && layout === 'hidden' && (
        <UISidebar
          width={sidebarWidth}
          setWidth={setSidebarWidth}
          isFloating
          isFloatingClosing={hoverClosing}
          onDismiss={() => setFloatingSidebarVisible(false)}
          {...sidebarProps}
        />
      )}
    </div>
  )
}
