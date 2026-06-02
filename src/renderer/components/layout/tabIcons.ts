import type { Tab } from '@renderer/hooks/useTabs'
import {
  Code,
  FileSearch,
  Folder,
  Globe,
  Home,
  Languages,
  LayoutGrid,
  Library,
  MessageCircle,
  MousePointerClick,
  NotepadText,
  Palette,
  Settings,
  Sparkle
} from 'lucide-react'

import { OpenClawSidebarIcon } from '../Icons/SvgIcon'

export type IconComponent = React.FC<{ size?: number; strokeWidth?: number; className?: string }>

// ─── Route → Icon mapping ─────────────────────────────────────────────────────

export const ROUTE_ICONS: Record<string, IconComponent> = {
  '/': Home,
  '/home': Home,
  '/app/chat': MessageCircle,
  '/app/agents': MousePointerClick,
  '/app/assistant': Sparkle,
  '/app/paintings': Palette,
  '/app/translate': Languages,
  '/app/mini-app': LayoutGrid,
  '/app/knowledge': FileSearch,
  '/app/library': Library,
  '/app/files': Folder,
  '/app/code': Code,
  '/app/notes': NotepadText,
  '/app/openclaw': OpenClawSidebarIcon,
  '/settings': Settings
}

export function getTabIcon(tab: Tab): IconComponent {
  if (tab.type === 'webview') return Globe
  const segments = tab.url.split('/').filter(Boolean)
  const key = segments[0] === 'app' && segments.length >= 2 ? '/app/' + segments[1] : '/' + (segments[0] || '')
  return ROUTE_ICONS[key] || MessageCircle
}
