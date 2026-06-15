import { usePersistCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { AppLogo } from '@renderer/config/env'
import useAvatar from '@renderer/hooks/useAvatar'
import { useTabs } from '@renderer/hooks/useTabs'
import { getSidebarIconLabelKey } from '@renderer/i18n/label'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import type { SidebarIcon as SidebarIconType } from '@shared/data/preference/preferenceTypes'
import {
  Code,
  FileSearch,
  Folder,
  Languages,
  LayoutGrid,
  MessageCircle,
  MousePointerClick,
  NotepadText,
  Palette,
  Sparkle
} from 'lucide-react'
import type { Ref } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { OpenClawSidebarIcon } from '../Icons/SvgIcon'
import UserPopup from '../Popups/UserPopup'
import { Sidebar as UISidebar } from '../Sidebar'
import { getSidebarDisplayWidth, getSidebarLayout, normalizeSidebarWidth } from '../Sidebar/constants'
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
  assistants: MessageCircle,
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

function getMenuPath(icon: SidebarIconType): string {
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

  // Floating sidebar (hover reveal when hidden)
  const [hoverVisible, setHoverVisible] = useState(false)
  const layout = getSidebarLayout(activeSidebarWidth)

  // Menu items
  const pathname = activeTab?.url || '/'

  const items = useMemo<SidebarMenuItem[]>(
    () =>
      visibleSidebarIcons.flatMap((icon) => {
        const path = getMenuPath(icon)
        const Icon = iconMap[icon]
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
    [visibleSidebarIcons, t]
  )

  const activeItem = resolveActiveItem(pathname)

  const handleNavigate = useCallback(
    async (menuItemId: string) => {
      const menuId = menuItemId as SidebarIconType
      const path = getMenuPath(menuId)
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
    [activeTab, updateTab, openTab]
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
