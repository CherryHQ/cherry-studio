import { OpenClawSidebarIcon } from '@renderer/components/icons/SvgIcon'
import type { SidebarAppId } from '@renderer/utils/sidebar'
import type { LucideIcon } from 'lucide-react'
import {
  Code,
  FileSearch,
  Folder,
  Languages,
  LayoutGrid,
  MessageSquare,
  MousePointerClick,
  NotepadText,
  Palette
} from 'lucide-react'

/**
 * Icon component for each built-in sidebar app. Keyed by the `SidebarAppId` union so the
 * compiler enforces full coverage — adding a new sidebar app id without an icon
 * here is a type error. Kept in the component layer because the values are React
 * components; the navigation data and logic live in `@renderer/utils/sidebar`.
 */
export const SIDEBAR_ICON_COMPONENTS: Record<SidebarAppId, LucideIcon> = {
  assistants: MessageSquare,
  agents: MousePointerClick,
  paintings: Palette,
  translate: Languages,
  mini_app: LayoutGrid,
  knowledge: FileSearch,
  files: Folder,
  code_tools: Code,
  notes: NotepadText,
  openclaw: OpenClawSidebarIcon
}
