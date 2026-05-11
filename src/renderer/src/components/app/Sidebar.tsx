import { usePersistCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { AppLogo } from '@renderer/config/env'
import useAvatar from '@renderer/hooks/useAvatar'
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
import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useTabs } from '../../hooks/useTabs'
import { OpenClawSidebarIcon } from '../Icons/SVGIcon'
import UserPopup from '../Popups/UserPopup'
import { Sidebar as UISidebar } from '../Sidebar'
import { getSidebarLayout } from '../Sidebar/constants'
import type { SidebarMenuItem, SidebarUser } from '../Sidebar/types'

const APP_LOGO = <img src={AppLogo} alt="Cherry Studio" className="h-9 w-9 rounded-lg" draggable={false} />
const noop = () => {}

const routePrefixMap: Record<SidebarIconType, string> = {
  assistants: '/app/chat',
  agents: '/app/agents',
  store: '/app/library',
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
  const { activeTab, updateTab, openTab } = useTabs()
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
            icon: Icon
          }
        ]
      }),
    [defaultPaintingProvider, visibleSidebarIcons]
  )

  const activeItem = resolveActiveItem(pathname)

  const handleNavigate = useCallback(
    async (menuItemId: string) => {
      const menuId = menuItemId as SidebarIconType
      const path = getMenuPath(menuId, defaultPaintingProvider)
      if (!path) return

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
    dockedTabs: [],
    onItemClick: handleNavigate,
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
