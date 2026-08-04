import type {
  QuickPanelContextType,
  QuickPanelInputAdapter,
  QuickPanelListItem,
  QuickPanelOpenOptions,
  QuickPanelTriggerInfo
} from '@renderer/components/QuickPanel'
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
  /**
   * Root panel placement. `'trailing'` renders the launcher after regular root-panel
   * launchers and caller-provided additional items. Defaults to leading.
   */
  rootPanelPlacement?: 'trailing'
  order?: number
  label: ReactNode | string
  description?: ReactNode | string
  tooltip?: ReactNode | string
  disabledReason?: ReactNode | string
  searchAliases?: readonly string[]
  icon: ReactNode | string
  suffix?: ReactNode | string
  active?: boolean
  showInActiveControls?: boolean
  disabled?: boolean
  hidden?: boolean
  /**
   * QuickPanel symbol of the panel this launcher's `action` opens, when it differs
   * from `id` (e.g. Knowledge Base opens the `#` panel). Lets the "open by launcherId"
   * control detect its own panel and toggle it closed on a second activation.
   */
  panelSymbol?: string
  submenu?: ComposerToolLauncher[]
  /**
   * Actionable rows owned by a custom panel that should participate in root-panel search.
   * They stay hidden in the unfiltered root list. Read-only/status rows must not be exposed here.
   */
  rootSearchItems?: readonly QuickPanelListItem[]
  action?: (options: ComposerToolLauncherActionOptions) => void
}
