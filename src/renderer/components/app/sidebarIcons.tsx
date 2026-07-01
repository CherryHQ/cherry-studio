import { OpenClawSidebarIcon } from '@renderer/components/Icons/SvgIcon'
import type { SidebarMenuItem } from '@renderer/components/Sidebar/types'
import type { SidebarFavorite } from '@shared/data/preference/preferenceTypes'
import {
  Code,
  FileSearch,
  Folder,
  Languages,
  LayoutGrid,
  Library,
  MessageSquare,
  MousePointerClick,
  NotepadText,
  Palette
} from 'lucide-react'

/**
 * Icon component for each sidebar app. Keyed by the `SidebarFavorite` union so the
 * compiler enforces full coverage — adding a new sidebar app id without an icon
 * here is a type error. Kept in the component layer because the values are React
 * components; the navigation data and logic live in `@renderer/utils/sidebar`.
 */
export const SIDEBAR_ICON_COMPONENTS: Record<SidebarFavorite, SidebarMenuItem['icon']> = {
  assistants: MessageSquare,
  agents: MousePointerClick,
  paintings: Palette,
  translate: Languages,
  store: Library,
  mini_app: LayoutGrid,
  knowledge: FileSearch,
  files: Folder,
  code_tools: Code,
  notes: NotepadText,
  openclaw: OpenClawSidebarIcon
}
