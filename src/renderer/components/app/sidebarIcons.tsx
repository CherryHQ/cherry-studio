import type { LucideProps } from 'lucide-react'
import {
  BotMessageSquare,
  Code,
  Database,
  FileSearch,
  FileText,
  Folder,
  Icon,
  Languages,
  LayoutGrid,
  MessageSquare,
  MessagesSquare,
  MousePointerClick,
  NotepadText,
  Package,
  Palette
} from 'lucide-react'
import type { ReactNode } from 'react'

import type { SidebarAppId } from '@renderer/utils/sidebar'

type SidebarIconComponent = (props: LucideProps) => ReactNode

const CodeMateIcon: SidebarIconComponent = (props) => <Code {...props} viewBox="-2 -2 28 28" />

/**
 * Icon component for each built-in sidebar app. Keyed by the `SidebarAppId` union so the
 * compiler enforces full coverage — adding a new sidebar app id without an icon
 * here is a type error. Kept in the component layer because the values are React
 * components; the navigation data and logic live in `@renderer/utils/sidebar`.
 */
export const SIDEBAR_ICON_COMPONENTS = {
  assistants: MessageSquare,
  agents: MousePointerClick,
  paintings: Palette,
  translate: Languages,
  mini_app: LayoutGrid,
  knowledge: FileSearch,
  files: Folder,
  code_tools: CodeMateIcon,
  notes: NotepadText
} satisfies Record<SidebarAppId, SidebarIconComponent>

const RESOURCE_ICON_COMPONENTS = {
  knowledgeBase: Database,
  topic: MessagesSquare,
  agentSession: BotMessageSquare,
  fileEntry: FileText,
  miniApp: Package
}

const NAVIGATION_ICON_COMPONENTS = { ...SIDEBAR_ICON_COMPONENTS, ...RESOURCE_ICON_COMPONENTS }
type SidebarGlyph = keyof typeof NAVIGATION_ICON_COMPONENTS

// Interior details are transparent cutouts so filled glyphs work on translucent sidebars too.
const FILLED_PATHS: Partial<Record<SidebarGlyph, string>> = {
  // Original Languages strokes expanded to 2.4-unit round fills; nonzero preserves their intersections.
  translate:
    'M4.151 8.849 10.151 14.849A1.2 1.2 0 0 0 11.849 13.151L5.849 7.151A1.2 1.2 0 0 0 4.151 8.849Z M4.849 14.849 10.849 8.849A1.2 1.2 0 0 0 9.151 7.151L3.151 13.151A1.2 1.2 0 0 0 4.849 14.849Z M10.998 8.666 12.998 5.666A1.2 1.2 0 0 0 11.002 4.334L9.002 7.334A1.2 1.2 0 0 0 10.998 8.666Z M2 6.2 14 6.2A1.2 1.2 0 0 0 14 3.8L2 3.8A1.2 1.2 0 0 0 2 6.2Z M7 3.2 8 3.2A1.2 1.2 0 0 0 8 0.8L7 0.8A1.2 1.2 0 0 0 7 3.2Z M23.073 21.463 18.073 11.463A1.2 1.2 0 0 0 15.927 12.537L20.927 22.537A1.2 1.2 0 0 0 23.073 21.463Z M15.927 11.463 10.927 21.463A1.2 1.2 0 0 0 13.073 22.537L18.073 12.537A1.2 1.2 0 0 0 15.927 11.463Z M14 19.2 20 19.2A1.2 1.2 0 0 0 20 16.8L14 16.8A1.2 1.2 0 0 0 14 19.2Z',
  code_tools: 'M7.1 5.1 8.9 6.9 3.8 12l5.1 5.1-1.8 1.8L.2 12Z M16.9 5.1 23.8 12l-6.9 6.9-1.8-1.8 5.1-5.1-5.1-5.1Z',
  paintings:
    'M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8Z M12 6.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0 M16 10.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0 M5 12.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0 M7 7.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0',
  knowledge:
    'M6 2h7v5a2 2 0 0 0 2 2h5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-.897a5.2 5.2 0 0 0 2.776-.216l.668.669a2.2 2.2 0 0 0 3.112-3.112l-.669-.668A5.2 5.2 0 0 0 4 8.897V4a2 2 0 0 1 2-2Z M15 2l5 5h-5Z M8.192 16.061l1.374 1.373a.8.8 0 0 1-1.132 1.132l-1.373-1.374a3.8 3.8 0 1 1 1.131-1.131Z',
  notes:
    'M6 4h1V2h2v2h2V2h2v2h2V2h2v2h1a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z M8 9v2h6V9Z M8 13v2h8v-2Z M8 17v2h5v-2Z',
  knowledgeBase:
    'M21 5a9 3 0 1 1-18 0 9 3 0 1 1 18 0Z M3 8c4 2.4 14 2.4 18 0v4c0 4-18 4-18 0Z M3 15c4 2.4 14 2.4 18 0v4c0 4-18 4-18 0Z',
  topic:
    'M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2Z M16 9h4a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-3h2a4 4 0 0 0 4-4Z',
  agentSession:
    'M8 1h5v5h5a2 2 0 0 1 2 2v3h2v2h-2v3a2 2 0 0 1-2 2H8l-4 4v-9H2v-2h2V8a2 2 0 0 1 2-2h5V3H8Z M8 10v4h2v-4Z M14 10v4h2v-4Z',
  fileEntry:
    'M6 2h7v5a2 2 0 0 0 2 2h5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z M15 2l5 5h-5Z M8 8v2h3V8Z M8 12v2h8v-2Z M8 16v2h8v-2Z',
  miniApp:
    'M8.3 3.813 11 2.27a2 2 0 0 1 2 0l7 4a2 2 0 0 1 .38.28L16.5 8.78Z M6.7 4.727 4 6.27a2 2 0 0 0-.38.28L12 11.36l2.9-1.665Z M3 8.03l8.2 4.706v9.095a2 2 0 0 1-.2-.101l-7-4A2 2 0 0 1 3 16Z M21 8.03l-8.2 4.706v9.095a2 2 0 0 0 .2-.101l7-4A2 2 0 0 0 21 16Z'
}

export function SidebarIcon({
  icon,
  active = false,
  ...props
}: LucideProps & { icon: SidebarGlyph; active?: boolean }) {
  const Outline = NAVIGATION_ICON_COMPONENTS[icon]
  if (!active) return <Outline {...props} />
  const filledPath = FILLED_PATHS[icon]
  if (filledPath) {
    return (
      <Icon
        {...props}
        viewBox={icon === 'code_tools' ? '-2 -2 28 28' : '-1 -1 26 26'}
        iconNode={[['path', { d: filledPath, key: 'fill' }]]}
        fill="currentColor"
        fillRule={icon === 'translate' ? 'nonzero' : 'evenodd'}
        stroke="none"
      />
    )
  }
  return <Outline {...props} viewBox="-1 -1 26 26" fill="currentColor" />
}
