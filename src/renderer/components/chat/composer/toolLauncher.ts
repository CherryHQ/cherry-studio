import type {
  QuickPanelContextType,
  QuickPanelInputAdapter,
  QuickPanelOpenOptions,
  QuickPanelTriggerInfo
} from '@renderer/components/chat/composer/panelEngine'
import type { ReactNode } from 'react'

export type ComposerToolLauncherKind = 'command' | 'panel' | 'dialog' | 'group'

export type ComposerToolLauncherSource = 'popover' | 'root-panel'

export interface ComposerToolLauncherActionOptions {
  quickPanel: QuickPanelContextType
  inputAdapter?: QuickPanelInputAdapter
  triggerInfo?: QuickPanelTriggerInfo
  parentPanel?: QuickPanelOpenOptions
  queryAnchor?: number
  searchText?: string
  source: ComposerToolLauncherSource
}

export interface ComposerToolLauncher {
  id: string
  kind: ComposerToolLauncherKind
  /**
   * Composer tools must declare where they can be launched from. QuickPanel is
   * only the search/list renderer; it is not the tool menu data source.
   */
  sources?: readonly ComposerToolLauncherSource[]
  order?: number
  label: ReactNode | string
  description?: ReactNode | string
  tooltip?: ReactNode | string
  disabledReason?: ReactNode | string
  icon: ReactNode | string
  suffix?: ReactNode | string
  active?: boolean
  showInActiveControls?: boolean
  disabled?: boolean
  hidden?: boolean
  submenu?: ComposerToolLauncher[]
  action?: (options: ComposerToolLauncherActionOptions) => void
}
