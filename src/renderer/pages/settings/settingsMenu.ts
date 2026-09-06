import { GatewayIcon } from '@renderer/components/icons/GatewayIcon'
import { McpLogo } from '@renderer/components/icons/SvgIcon'
import { SETTINGS_NAVIGATION_LABEL_KEYS } from '@renderer/utils/settingsNavigation'
import {
  Activity,
  Bell,
  CalendarClock,
  Cloud,
  Command,
  Crop,
  FileBox,
  FileCode,
  HardDrive,
  Info,
  Package,
  Palette,
  PictureInPicture2,
  Radio,
  ScanText,
  Search,
  Settings2,
  Terminal,
  TextCursorInput,
  ToolCase,
  Zap
} from 'lucide-react'
import type { ReactNode } from 'react'
import { createElement } from 'react'

export interface SettingsMenuEntry {
  /** Settings section route; also the aggregation key for `.search.ts` leaves */
  route: string
  /** i18n key of the menu title — always searchable as the section baseline */
  titleKey: string
  icon: ReactNode
  /** Group title key (`settings.menuGroups.*`); omitted for the ungrouped head section */
  groupKey?: string
}

/**
 * Single source of truth for the settings sidebar menu.
 * Array order = menu render order = search tie-break order.
 * Adding a settings section requires registering it here, which also makes its
 * title searchable — the settings search baseline is structural, not manual.
 */
export const settingsMenu: readonly SettingsMenuEntry[] = [
  {
    route: '/settings/provider',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/provider'],
    icon: createElement(Cloud)
  },
  {
    route: '/settings/model',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/model'],
    icon: createElement(Package)
  },
  {
    route: '/settings/local-models',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/local-models'],
    icon: createElement(FileBox)
  },
  {
    route: '/settings/api-gateway',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/api-gateway'],
    icon: createElement(GatewayIcon)
  },
  {
    route: '/settings/mcp',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/mcp'],
    icon: createElement(McpLogo, { width: 16, height: 16, className: 'text-foreground' }),
    groupKey: 'settings.menuGroups.capabilities'
  },
  {
    route: '/settings/skills',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/skills'],
    icon: createElement(ToolCase),
    groupKey: 'settings.menuGroups.capabilities'
  },
  {
    route: '/settings/prompts',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/prompts'],
    icon: createElement(Zap),
    groupKey: 'settings.menuGroups.capabilities'
  },
  {
    route: '/settings/websearch',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/websearch'],
    icon: createElement(Search),
    groupKey: 'settings.menuGroups.capabilities'
  },
  {
    route: '/settings/file-processing',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/file-processing'],
    icon: createElement(FileCode),
    groupKey: 'settings.menuGroups.capabilities'
  },
  {
    route: '/settings/ocr',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/ocr'],
    icon: createElement(ScanText),
    groupKey: 'settings.menuGroups.capabilities'
  },
  {
    route: '/settings/general',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/general'],
    icon: createElement(Settings2),
    groupKey: 'settings.menuGroups.personal'
  },
  {
    route: '/settings/appearance',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/appearance'],
    icon: createElement(Palette),
    groupKey: 'settings.menuGroups.personal'
  },
  {
    route: '/settings/notifications',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/notifications'],
    icon: createElement(Bell),
    groupKey: 'settings.menuGroups.personal'
  },
  {
    route: '/settings/data',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/data'],
    icon: createElement(HardDrive),
    groupKey: 'settings.menuGroups.personal'
  },
  {
    route: '/settings/usage',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/usage'],
    icon: createElement(Activity),
    groupKey: 'settings.menuGroups.personal'
  },
  {
    route: '/settings/channels',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/channels'],
    icon: createElement(Radio),
    groupKey: 'settings.menuGroups.automation'
  },
  {
    route: '/settings/scheduled-tasks',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/scheduled-tasks'],
    icon: createElement(CalendarClock),
    groupKey: 'settings.menuGroups.automation'
  },
  {
    route: '/settings/shortcut',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/shortcut'],
    icon: createElement(Command),
    groupKey: 'settings.menuGroups.automation'
  },
  {
    route: '/settings/quick-assistant',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/quick-assistant'],
    icon: createElement(PictureInPicture2),
    groupKey: 'settings.menuGroups.automation'
  },
  {
    route: '/settings/selection-assistant',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/selection-assistant'],
    icon: createElement(TextCursorInput),
    groupKey: 'settings.menuGroups.automation'
  },
  {
    route: '/settings/screenshot',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/screenshot'],
    icon: createElement(Crop),
    groupKey: 'settings.menuGroups.automation'
  },
  {
    route: '/settings/dependencies',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/dependencies'],
    icon: createElement(Terminal),
    groupKey: 'settings.menuGroups.system'
  },
  {
    route: '/settings/about',
    titleKey: SETTINGS_NAVIGATION_LABEL_KEYS['/settings/about'],
    icon: createElement(Info),
    groupKey: 'settings.menuGroups.system'
  }
]
