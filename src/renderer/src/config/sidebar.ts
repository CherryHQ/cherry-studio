import { OpenClawSidebarIcon } from '@renderer/components/Icons/SVGIcon'
import type { SidebarMenuItem } from '@renderer/components/Sidebar/types'
import type { SidebarIcon } from '@shared/data/preference/preferenceTypes'
import { getDefaultValue } from '@shared/data/preference/preferenceUtils'
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

//TODO 这个文件是否还有存在的价值？ fullex @ data refactor

/**
 * 侧边栏支持的完整菜单顺序。
 * Preference 默认值可能不包含新菜单，管理态列表仍需要覆盖当前全部支持项。
 */
export const SIDEBAR_ICON_ORDER: SidebarIcon[] = [
  'assistants',
  'agents',
  'store',
  'paintings',
  'translate',
  'mini_app',
  'knowledge',
  'files',
  'code_tools',
  'notes',
  'openclaw'
]

/**
 * 必须显示的侧边栏图标（不能被隐藏）
 * 这些图标必须始终在侧边栏中可见
 * 抽取为参数方便未来扩展
 */
export const REQUIRED_SIDEBAR_ICONS: SidebarIcon[] = ['assistants']

const sidebarIconSet = new Set<SidebarIcon>(SIDEBAR_ICON_ORDER)

export const SIDEBAR_ROUTE_PREFIX_MAP: Record<SidebarIcon, string> = {
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

export const SIDEBAR_ICON_COMPONENTS: Record<SidebarIcon, SidebarMenuItem['icon']> = {
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

type SidebarIconPreferences = {
  visible: SidebarIcon[]
  invisible: SidebarIcon[]
}

export function getSidebarMenuPath(icon: SidebarIcon, defaultPaintingProvider: string): string {
  if (icon === 'paintings') {
    return `/app/paintings/${defaultPaintingProvider}`
  }

  return SIDEBAR_ROUTE_PREFIX_MAP[icon] || ''
}

export function resolveSidebarActiveItem(pathname: string): SidebarIcon | '' {
  const match = (Object.entries(SIDEBAR_ROUTE_PREFIX_MAP) as Array<[SidebarIcon, string]>).find(
    ([, prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )

  return match?.[0] || ''
}

export function sanitizeSidebarIcons(icons: readonly SidebarIcon[] | undefined): SidebarIcon[] {
  const seen = new Set<SidebarIcon>()

  return (icons ?? []).filter((icon) => {
    if (!sidebarIconSet.has(icon) || seen.has(icon)) {
      return false
    }

    seen.add(icon)
    return true
  })
}

export function getRequiredSidebarIconsVisible(icons: readonly SidebarIcon[] | undefined): SidebarIcon[] {
  const visible = new Set(sanitizeSidebarIcons(icons))

  for (const icon of REQUIRED_SIDEBAR_ICONS) {
    visible.add(icon)
  }

  return SIDEBAR_ICON_ORDER.filter((icon) => visible.has(icon))
}

export function getOrderedVisibleSidebarIcons(icons: readonly SidebarIcon[] | undefined): SidebarIcon[] {
  const visible = sanitizeSidebarIcons(icons)

  for (const icon of REQUIRED_SIDEBAR_ICONS) {
    if (visible.includes(icon)) continue

    const iconOrder = SIDEBAR_ICON_ORDER.indexOf(icon)
    const insertIndex = visible.findIndex((visibleIcon) => SIDEBAR_ICON_ORDER.indexOf(visibleIcon) > iconOrder)
    visible.splice(insertIndex === -1 ? visible.length : insertIndex, 0, icon)
  }

  return visible
}

export function buildSidebarIconManagerItems(): SidebarIcon[] {
  return [...SIDEBAR_ICON_ORDER]
}

export function getSidebarIconPreferencesFromVisibleIcons({
  visibleIcons
}: {
  visibleIcons: ReadonlySet<SidebarIcon>
}): SidebarIconPreferences {
  const requiredIcons = new Set(REQUIRED_SIDEBAR_ICONS)
  const nextVisible = SIDEBAR_ICON_ORDER.filter((icon) => visibleIcons.has(icon) || requiredIcons.has(icon))
  const nextInvisible = SIDEBAR_ICON_ORDER.filter((icon) => !visibleIcons.has(icon) && !requiredIcons.has(icon))

  return {
    visible: nextVisible,
    invisible: nextInvisible
  }
}

export function getDefaultSidebarIconPreferences(): SidebarIconPreferences {
  return {
    visible: getRequiredSidebarIconsVisible(getDefaultValue('ui.sidebar.icons.visible')),
    invisible: sanitizeSidebarIcons(getDefaultValue('ui.sidebar.icons.invisible'))
  }
}
