import type { ResolvedMenuItem } from '@shared/types/command'
import type { CommandId } from '@shared/utils/command'
import type { KeyboardEvent, MenuItem, MenuItemConstructorOptions } from 'electron'

export interface NativeMenuCommandExecutionContext {
  menuItem: MenuItem
  browserWindow?: Parameters<NonNullable<MenuItemConstructorOptions['click']>>[1]
  event: KeyboardEvent
}

export type NativeCommandMenuItem = Extract<ResolvedMenuItem<CommandId>, { type: 'command' }>

export type NativeMenuItem =
  | NativeCommandMenuItem
  | { type: 'separator' }
  | {
      type: 'submenu'
      label: string
      enabled?: boolean
      iconKey?: string
      children: NativeMenuItem[]
    }
  | {
      type: 'role'
      role: NonNullable<MenuItemConstructorOptions['role']>
      label?: string
      enabled?: boolean
      accelerator?: string
    }
  | {
      type: 'custom'
      label: string
      enabled?: boolean
      checked?: boolean
      accelerator?: string
      click: () => void
    }

export interface NativeMenuTemplateOptions {
  registerAccelerator?: boolean
  executeCommand: (command: CommandId, context: NativeMenuCommandExecutionContext) => void
}

const registerAcceleratorOption = (
  registerAccelerator: boolean
): Pick<MenuItemConstructorOptions, 'registerAccelerator'> =>
  registerAccelerator ? {} : { registerAccelerator: false }

const enabledOption = (enabled: boolean | undefined): Pick<MenuItemConstructorOptions, 'enabled'> =>
  enabled === undefined ? {} : { enabled }

export const toElectronMenuTemplate = (
  items: readonly NativeMenuItem[],
  options: NativeMenuTemplateOptions
): MenuItemConstructorOptions[] => {
  const registerAccelerator = options.registerAccelerator ?? true

  return items.map((item) => {
    if (item.type === 'separator') {
      return { type: 'separator' }
    }

    if (item.type === 'role') {
      return {
        role: item.role,
        label: item.label,
        accelerator: item.accelerator,
        ...enabledOption(item.enabled)
      }
    }

    if (item.type === 'custom') {
      return {
        label: item.label,
        type: item.checked === undefined ? 'normal' : 'checkbox',
        checked: item.checked,
        accelerator: item.accelerator,
        ...enabledOption(item.enabled),
        click: () => item.click()
      }
    }

    if (item.type === 'submenu') {
      return {
        label: item.label,
        ...enabledOption(item.enabled),
        submenu: toElectronMenuTemplate(item.children, options)
      }
    }

    return {
      label: item.label,
      enabled: item.enabled,
      type: item.checked === undefined ? 'normal' : 'checkbox',
      checked: item.checked,
      accelerator: item.accelerator,
      ...registerAcceleratorOption(registerAccelerator),
      click: (menuItem, browserWindow, event) =>
        options.executeCommand(item.command, { menuItem, browserWindow, event })
    }
  })
}
