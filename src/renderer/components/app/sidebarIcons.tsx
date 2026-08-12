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
  notes: NotepadText
}

/**
 * Tile background behind each sidebar app icon. Paired with
 * {@link SIDEBAR_ICON_COMPONENTS} — anywhere the launcher tiles are drawn needs
 * both, so they live together rather than in the navigation data.
 */
export const APP_ICON_BACKGROUNDS: Record<SidebarAppId, string> = {
  assistants: 'linear-gradient(135deg, #1F2937, #374151)',
  agents: 'linear-gradient(135deg, #2563EB, #38BDF8)',
  paintings: 'linear-gradient(135deg, #EC4899, #F472B6)',
  translate: 'linear-gradient(135deg, #06B6D4, #0EA5E9)',
  mini_app: 'linear-gradient(135deg, #8B5CF6, #A855F7)',
  knowledge: 'linear-gradient(135deg, #10B981, #34D399)',
  files: 'linear-gradient(135deg, #F59E0B, #FBBF24)',
  code_tools: 'linear-gradient(135deg, #4B5563, #6B7280)',
  notes: 'linear-gradient(135deg, #F97316, #FB923C)'
}
