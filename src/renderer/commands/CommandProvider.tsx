import { useMultiplePreferences } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { platform } from '@renderer/config/constant'
import {
  type CommandId,
  type ContextReader,
  getShortcutBindingFromKeyboardEvent,
  REGISTERED_KEYBINDINGS,
  resolveCommandByKeybinding,
  type SupportedPlatform
} from '@shared/commands'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import React, { createContext, use, useCallback, useEffect, useMemo, useRef } from 'react'

import { useCommandContextSnapshot } from './ContextKeyProvider'

const logger = loggerService.withContext('CommandProvider')

export type CommandHandler = () => void | Promise<void>

export interface CommandHandlerOptions {
  enabled?: boolean
}

interface CommandHandlerEntry {
  id: number
  handler: CommandHandler
  enabled: boolean
}

interface CommandDispatcherState {
  context: ContextReader
  shortcutPreferences: Partial<Record<CommandId, PreferenceShortcutType>>
  hasHandler: (command: CommandId) => boolean
  execute: (command: CommandId) => void
}

interface CommandRuntime {
  execute: (command: CommandId) => void
  hasHandler: (command: CommandId) => boolean
  registerHandler: (command: CommandId, handler: CommandHandler, options?: CommandHandlerOptions) => () => void
}

const CommandRuntimeContext = createContext<CommandRuntime | null>(null)

const shortcutPreferenceKeys = Object.fromEntries(
  REGISTERED_KEYBINDINGS.map((rule) => [rule.command, rule.preferenceKey])
) as Record<CommandId, (typeof REGISTERED_KEYBINDINGS)[number]['preferenceKey']>

export function CommandProvider({ children }: { children: React.ReactNode }) {
  const contextSnapshot = useCommandContextSnapshot()
  const [shortcutPreferences] = useMultiplePreferences(shortcutPreferenceKeys)

  const nextHandlerIdRef = useRef(0)
  const handlersRef = useRef(new Map<CommandId, CommandHandlerEntry[]>())
  const dispatcherStateRef = useRef<CommandDispatcherState>({
    context: contextSnapshot,
    shortcutPreferences: shortcutPreferences as Partial<Record<CommandId, PreferenceShortcutType>>,
    hasHandler: () => false,
    execute: () => {}
  })

  const getActiveHandler = useCallback((command: CommandId): CommandHandlerEntry | undefined => {
    const handlers = handlersRef.current.get(command)
    return handlers?.findLast((entry) => entry.enabled)
  }, [])

  const registerHandler = useCallback(
    (command: CommandId, handler: CommandHandler, options?: CommandHandlerOptions) => {
      const entry: CommandHandlerEntry = {
        id: nextHandlerIdRef.current++,
        handler,
        enabled: options?.enabled !== false
      }
      const handlers = handlersRef.current.get(command) ?? []
      handlers.push(entry)
      handlersRef.current.set(command, handlers)

      return () => {
        const currentHandlers = handlersRef.current.get(command)
        if (!currentHandlers) {
          return
        }

        const nextHandlers = currentHandlers.filter((current) => current.id !== entry.id)
        if (nextHandlers.length > 0) {
          handlersRef.current.set(command, nextHandlers)
        } else {
          handlersRef.current.delete(command)
        }
      }
    },
    []
  )

  const hasHandler = useCallback((command: CommandId) => Boolean(getActiveHandler(command)), [getActiveHandler])

  const execute = useCallback(
    (command: CommandId) => {
      const handler = getActiveHandler(command)?.handler
      if (!handler) {
        logger.warn(`No renderer command handler registered: ${command}`)
        return
      }

      try {
        void Promise.resolve(handler()).catch((error) => {
          logger.error(`Renderer command handler failed: ${command}`, error as Error)
        })
      } catch (error) {
        logger.error(`Renderer command handler failed: ${command}`, error as Error)
      }
    },
    [getActiveHandler]
  )

  useEffect(() => {
    dispatcherStateRef.current = {
      context: contextSnapshot,
      shortcutPreferences: shortcutPreferences as Partial<Record<CommandId, PreferenceShortcutType>>,
      hasHandler,
      execute
    }
  }, [contextSnapshot, execute, hasHandler, shortcutPreferences])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) {
        return
      }

      const state = dispatcherStateRef.current
      const binding = getShortcutBindingFromKeyboardEvent(event, platform as SupportedPlatform)
      const command = resolveCommandByKeybinding({
        binding,
        preferences: state.shortcutPreferences,
        context: state.context,
        platform: platform as SupportedPlatform,
        scope: 'renderer',
        canExecuteCommand: state.hasHandler
      })

      if (!command) {
        return
      }

      event.preventDefault()
      state.execute(command)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const value = useMemo(
    () => ({
      execute,
      hasHandler,
      registerHandler
    }),
    [execute, hasHandler, registerHandler]
  )

  useEffect(() => {
    return window.api.command?.onExecuteFromNativeMenu?.(execute)
  }, [execute])

  return <CommandRuntimeContext value={value}>{children}</CommandRuntimeContext>
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

export function useCommandRuntime(): CommandRuntime {
  const runtime = use(CommandRuntimeContext)
  if (runtime) {
    return runtime
  }

  return {
    execute: (command) => logger.warn(`No renderer command runtime mounted: ${command}`),
    hasHandler: () => false,
    registerHandler: () => () => {}
  }
}
