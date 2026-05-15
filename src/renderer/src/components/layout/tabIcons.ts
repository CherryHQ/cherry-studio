import {
  BookOpen,
  Bot,
  Code,
  Files,
  FileText,
  Globe,
  Home,
  Languages,
  MessageCircle,
  Palette,
  Settings,
  Sparkles
} from 'lucide-react'

import type { Tab } from '../../hooks/useTabs'

export type IconComponent = React.FC<{ size?: number; strokeWidth?: number; className?: string }>

// ─── Route → Icon mapping ─────────────────────────────────────────────────────

export const ROUTE_ICONS: Record<string, IconComponent> = {
  '/': Home,
  '/home': Home,
  '/app/chat': MessageCircle,
  '/app/agents': Bot,
  '/app/assistant': Sparkles,
  '/app/paintings': Palette,
  '/app/translate': Languages,
  '/app/mini-app': Globe,
  '/app/knowledge': BookOpen,
  '/app/files': Files,
  '/app/code': Code,
  '/app/notes': FileText,
  '/settings': Settings
}

export function getTabIcon(tab: Tab): IconComponent {
  if (tab.type === 'webview') return Globe
  const segments = tab.url.split('/').filter(Boolean)
  const key = segments[0] === 'app' && segments.length >= 2 ? '/app/' + segments[1] : '/' + (segments[0] || '')
  return ROUTE_ICONS[key] || MessageCircle
}
