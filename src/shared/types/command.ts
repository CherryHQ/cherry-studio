import type { PreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import type { ShortcutBinding } from '@shared/utils/shortcut'

export type CommandScope = 'main' | 'renderer' | 'both'

export type CommandShortcutPreferenceKey<TCommand extends string = string> = Extract<
  PreferenceKeyType,
  `shortcut.${TCommand}`
>

export type ContextExprSource = string

export type ContextValue = string | number | boolean | null | undefined

export type ContextReader =
  | ReadonlyMap<string, ContextValue>
  | Record<string, ContextValue>
  | ((key: string) => ContextValue)

export type ContextExpr =
  | { type: 'key'; key: string }
  | { type: 'not'; expr: ContextExpr }
  | { type: 'and'; exprs: ContextExpr[] }
  | { type: 'or'; exprs: ContextExpr[] }
  | { type: 'equals'; key: string; value: string | number | boolean }
  | { type: 'notEquals'; key: string; value: string | number | boolean }

export type SupportedPlatform = Extract<NodeJS.Platform, 'darwin' | 'win32' | 'linux'>

export interface KeybindingRule<TCommand extends string = string> {
  command: TCommand
  defaultBinding: ShortcutBinding
  additionalBindings?: readonly ShortcutBinding[]
  scope: CommandScope
  global?: boolean
  editable?: boolean
  when?: ContextExprSource
  supportedPlatforms?: SupportedPlatform[]
}

export type CommandKeybindingContribution = Omit<KeybindingRule<string>, 'command' | 'scope'>

export interface CommandDefinition<TCommand extends string = string> {
  id: TCommand
  titleKey: string
  categoryKey: string
  scope: CommandScope
  iconKey?: string
  enablement?: ContextExprSource
  keybinding?: CommandKeybindingContribution
}

export interface RegisteredCommandDefinition<TCommand extends string = string>
  extends Omit<CommandDefinition<TCommand>, 'enablement' | 'keybinding'> {
  enablement?: ContextExpr
  enablementSource?: ContextExprSource
}

export interface RegisteredKeybindingRule<TCommand extends string = string>
  extends Omit<KeybindingRule<TCommand>, 'when'> {
  preferenceKey: CommandShortcutPreferenceKey<TCommand>
  when?: ContextExpr
  whenSource?: ContextExprSource
}

export type MenuPresentationMode = 'native' | 'cherry'

export type MenuLocation =
  | 'app.menu'
  | 'tray.menu'
  | 'webcontents.context'
  | 'chat.input.toolbar'
  | 'chat.input.tools.context'
  | 'chat.message.context'
  | 'topic.context'
  | 'command.palette'

export interface MenuContribution<TCommand extends string = string> {
  location: MenuLocation
  command: TCommand
  group: string
  order: number
  when?: ContextExprSource
}

export interface RegisteredMenuContribution<TCommand extends string = string>
  extends Omit<MenuContribution<TCommand>, 'when'> {
  when?: ContextExpr
  whenSource?: ContextExprSource
}

export type ResolvedMenuItem<TCommand extends string = string> =
  | { type: 'separator' }
  | {
      type: 'command'
      command: TCommand
      label: string
      enabled: boolean
      checked?: boolean
      destructive?: boolean
      iconKey?: string
      shortcutLabel: string
      accelerator?: string
    }
  | {
      type: 'submenu'
      label: string
      enabled: boolean
      iconKey?: string
      children: ResolvedMenuItem<TCommand>[]
    }

export interface ResolvedMenuModel<TCommand extends string = string> {
  location: MenuLocation
  items: ResolvedMenuItem<TCommand>[]
}

export type NativePopupMenuItem<TCommand extends string = string> =
  | { type: 'separator' }
  | {
      type: 'command'
      command: TCommand
      label: string
      enabled: boolean
      checked?: boolean
      destructive?: boolean
      iconKey?: string
      shortcutLabel: string
      accelerator?: string
    }
  | {
      type: 'submenu'
      label: string
      enabled: boolean
      iconKey?: string
      children: NativePopupMenuItem<TCommand>[]
    }
  | {
      type: 'custom'
      id: string
      label: string
      enabled?: boolean
      checked?: boolean
      shortcutLabel?: string
      accelerator?: string
    }

export interface NativePopupMenuModel<TCommand extends string = string> {
  location: MenuLocation
  items: NativePopupMenuItem<TCommand>[]
}

export type NativePopupMenuResult<TCommand extends string = string> =
  | { type: 'command'; command: TCommand }
  | { type: 'custom'; id: string }

export interface MenuAnchor {
  x?: number
  y?: number
}

export interface ResolvedCommandState<TCommand extends string = string> {
  id: TCommand
  label: string
  enabled: boolean
  shortcutLabel: string
  accelerator?: string
  iconKey?: string
}
