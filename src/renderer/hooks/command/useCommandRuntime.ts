import { loggerService } from '@logger'
import type { CommandId, MenuPresentationMode } from '@shared/command'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import { createContext, use, useEffect, useRef } from 'react'

const logger = loggerService.withContext('useCommandRuntime')

export type CommandHandler = () => void | Promise<void>

export interface CommandHandlerOptions {
  enabled?: boolean
}

export interface CommandRuntime {
  execute: (command: CommandId) => void
  hasHandler: (command: CommandId) => boolean
  registerHandler: (command: CommandId, handler: CommandHandler, options?: CommandHandlerOptions) => () => void
}

export interface CommandSharedPreferences {
  shortcutPreferences: Partial<Record<CommandId, PreferenceShortcutType>>
  menuPresentationMode: MenuPresentationMode | undefined
}

const EMPTY_SHORTCUT_PREFERENCES: Partial<Record<CommandId, PreferenceShortcutType>> = {}

const NO_OP_RUNTIME: CommandRuntime = {
  execute: (command) => logger.warn(`No renderer command runtime mounted: ${command}`),
  hasHandler: () => false,
  registerHandler: () => () => {}
}

export const CommandRuntimeContext = createContext<CommandRuntime | null>(null)
export const CommandSharedPreferencesContext = createContext<CommandSharedPreferences | null>(null)

export function useCommandRuntime(): CommandRuntime {
  return use(CommandRuntimeContext) ?? NO_OP_RUNTIME
}

export function useCommandHandler(command: CommandId, handler: CommandHandler, options?: CommandHandlerOptions): void {
  const runtime = useCommandRuntime()
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  const enabled = options?.enabled !== false

  useEffect(() => {
    return runtime.registerHandler(command, () => handlerRef.current(), { enabled })
  }, [command, enabled, runtime])
}

/**
 * Single-subscriber accessor for the shortcut preference map. Reads from the
 * context populated by `CommandProvider`; falls back to an empty map outside any
 * provider (tests, isolated windows).
 *
 * Direct `useMultiplePreferences(shortcutPreferenceKeys)` calls multiply IPC
 * listeners per render — N consumers × ~18 keys froze the settings window.
 */
export function useCommandShortcutPreferences(): Partial<Record<CommandId, PreferenceShortcutType>> {
  return use(CommandSharedPreferencesContext)?.shortcutPreferences ?? EMPTY_SHORTCUT_PREFERENCES
}

export function useCommandMenuPresentationMode(): MenuPresentationMode | undefined {
  return use(CommandSharedPreferencesContext)?.menuPresentationMode
}
