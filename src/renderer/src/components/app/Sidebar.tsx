import { Sidebar as UISidebar } from '@cherrystudio/ui/components/sidebar/Sidebar'
import type { SidebarMenuItem } from '@cherrystudio/ui/components/sidebar/types'
import { usePreference } from '@data/hooks/usePreference'
import { AppLogo } from '@renderer/config/env'
import { modelGenerating } from '@renderer/hooks/useModel'
import { useSettings } from '@renderer/hooks/useSettings'
import { getSidebarIconLabel } from '@renderer/i18n/label'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import type { SidebarIcon as SidebarIconType } from '@shared/data/preference/preferenceTypes'
import {
  BarChart3,
  Code,
  FileSearch,
  Languages,
  LayoutGrid,
  MessageSquare,
  MousePointerClick,
  NotepadText,
  Palette,
  Sparkle
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useTabs } from '../../hooks/useTabs'
import { OpenClawSidebarIcon } from '../Icons/SVGIcon'
const DEFAULT_SIDEBAR_WIDTH = 200

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
  files: BarChart3,
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

function getInitialSidebarWidth(): number {
  const rawWidth = window.getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width').trim()
  const parsedWidth = Number.parseFloat(rawWidth)
  return Number.isFinite(parsedWidth) ? parsedWidth : DEFAULT_SIDEBAR_WIDTH
}

const Sidebar = () => {
  const [visibleSidebarIcons] = usePreference('ui.sidebar.icons.visible')
  const { activeTab, activeTabId, updateTab } = useTabs()
  const { defaultPaintingProvider } = useSettings()
  const { t } = useTranslation()
  const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth)

  const pathname = activeTab?.url || '/'

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`)
  }, [sidebarWidth])

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

  const handleNavigate = async (menuItemId: string) => {
    const path = getMenuPath(menuItemId as SidebarIconType, defaultPaintingProvider)
    if (!path) {
      return
    }

    await modelGenerating()
    if (activeTabId) {
      updateTab(activeTabId, { url: path, title: getDefaultRouteTitle(path) })
    }
  }

  return (
    <div id="app-sidebar" className="h-full [-webkit-app-region:no-drag]">
      <UISidebar
        width={sidebarWidth}
        setWidth={setSidebarWidth}
        activeItem={activeItem}
        items={items}
        title="Cherry Studio"
        logo={<img src={AppLogo} alt="Cherry Studio" className="h-9 w-9 rounded-lg" draggable={false} />}
        searchLabel={t('common.search')}
        extensionsLabel=""
        onItemClick={handleNavigate}
        onSearchClick={() => {}}
      />
    </div>
  )
}

export default Sidebar
