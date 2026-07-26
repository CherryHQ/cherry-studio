import type { Tab } from '@renderer/hooks/tab'
import {
  Code,
  FileSearch,
  Folder,
  Globe,
  Languages,
  LayoutGrid,
  MessageCircle,
  MousePointerClick,
  NotepadText,
  Palette,
  Rocket,
  ScanSearch,
  Settings
} from 'lucide-react'

export type IconComponent = React.FC<{ size?: number; strokeWidth?: number; className?: string }>

// ─── Route → Icon mapping ─────────────────────────────────────────────────────

export const ROUTE_ICONS: Record<string, IconComponent> = {
  '/app/chat': MessageCircle,
  '/app/agents': MousePointerClick,
  '/app/paintings': Palette,
  '/app/translate': Languages,
  '/app/mini-app': LayoutGrid,
  '/app/launchpad': Rocket,
  '/app/knowledge': FileSearch,
  '/app/file-preview': ScanSearch,
  '/app/files': Folder,
  '/app/code': Code,
  '/app/notes': NotepadText,
  '/settings': Settings
}

export function getTabIcon(tab: Tab): IconComponent {
  if (tab.type === 'webview') return Globe
  const pathname = new URL(tab.url, 'https://www.cherry-ai.com/').pathname
  const segments = pathname.split('/').filter(Boolean)
  const key = segments[0] === 'app' && segments.length >= 2 ? '/app/' + segments[1] : '/' + (segments[0] || '')
  return ROUTE_ICONS[key] || MessageCircle
}
