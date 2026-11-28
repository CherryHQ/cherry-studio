import { createContext, type RefObject, use, useCallback, useLayoutEffect, useRef } from 'react'

import { loggerService } from '@logger'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import type { MenuPresentationMode } from '@shared/types/command'
import { type CommandId, COMMAND_DEFINITIONS } from '@shared/utils/command'

import {
  CommandFocusHostContext,
  CommandFocusScopeContext,
  CommandFocusScopeState,
  isCommandInvocationActive,
  readRegisteredHandler
} from './commandFocusScope'

const logger = loggerService.withContext('useCommandRuntime')

export type CommandHandler = (args?: unknown) => void | Promise<void>
export type CommandHandlerSource = CommandHandler | Readonly<RefObject<CommandHandler>>

export function runCommandHandler(command: CommandId, handler: CommandHandler, args?: unknown): void {
  try {
    void Promise.resolve(handler(args)).catch((error) =>
      logger.error(`Renderer command handler failed: ${command}`, error as Error)
    )
  } catch (error) {
    logger.error(`Renderer command handler failed: ${command}`, error as Error)
  }
}

export interface CommandHandlerOptions {
  enabled?: boolean | (() => boolean)
  allowInKeyboardLayer?: boolean
  /** Synchronous keyboard-routing predicate; only consulted for keyboard dispatch. */
  shouldHandleKeyEvent?: (event: KeyboardEvent) => boolean
}

export interface CommandRuntime {
  execute: (command: CommandId, args?: unknown) => void
  hasHandler: (command: CommandId) => boolean
  registerHandler: (command: CommandId, handler: CommandHandlerSource, options?: CommandHandlerOptions) => () => void
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
  const predicateRef = useRef(options?.shouldHandleKeyEvent)
  predicateRef.current = options?.shouldHandleKeyEvent
  const allowedRef = useRef(options?.allowInKeyboardLayer)
  allowedRef.current = options?.allowInKeyboardLayer
  const enabledRef = useRef(options?.enabled)
  enabledRef.current = options?.enabled

  useLayoutEffect(() => {
    return runtime.registerHandler(command, handlerRef, {
      get allowInKeyboardLayer() {
        return allowedRef.current
      },
      get enabled() {
        return enabledRef.current
      },
      shouldHandleKeyEvent: (event) => predicateRef.current?.(event) ?? true
    })
  }, [command, runtime])
}

/**
 * Single-subscriber accessor for the shortcut preference map. Reads from the
 * context populated by `CommandProvider`; falls back to an empty map outside any
 * provider (tests, isolated windows).
 *
 * Direct `useMultiplePreferences(shortcutPreferenceKeys)` calls multiply IPC
 * listeners per render — N consumers × ~18 keys overload the shared command runtime.
 */
export function useCommandShortcutPreferences(): Partial<Record<CommandId, PreferenceShortcutType>> {
  return use(CommandSharedPreferencesContext)?.shortcutPreferences ?? EMPTY_SHORTCUT_PREFERENCES
}

export function useCommandMenuPresentationMode(): MenuPresentationMode | undefined {
  return use(CommandSharedPreferencesContext)?.menuPresentationMode
}

export function useCommandOrigin() {
  const scope = use(CommandFocusScopeContext)
  const host = use(CommandFocusHostContext)
  const runtime = useCommandRuntime()
  return useCallback(
    (target?: EventTarget | null) => {
      let origin = scope
      for (let node = target instanceof HTMLElement ? target : null; node; node = node.parentElement) {
        const registered = host?.registry.roots.get(node)
        if (registered) {
          origin = registered
          break
        }
      }
      const element = target instanceof HTMLElement ? target : null
      const isActive = () => (!element || element.isConnected) && (origin?.isActive() ?? true)
      if (!origin) return { isActive, execute: runtime.execute }
      const originScope = origin
      const captured = new Map(
        COMMAND_DEFINITIONS.flatMap(({ id }) => {
          const invocation = host?.registry.resolveInvocation(originScope, host.rootScope, id)
          return invocation ? [[id, invocation] as const] : []
        })
      )
      return {
        isActive,
        execute: (command: CommandId, args?: unknown) => {
          const selected = captured.get(command)
          if (!isActive() || !selected) return
          if (!isCommandInvocationActive(selected) || readRegisteredHandler(selected.entry) !== selected.handler) return
          runCommandHandler(command, selected.handler, args)
        }
      }
    },
    [host, runtime, scope]
  )
}

export function useCommandKeyboardBoundary() {
  const host = use(CommandFocusHostContext)
  const disposables = useRef(new Set<() => void>())
  useLayoutEffect(
    () => () => {
      for (const dispose of disposables.current) dispose()
    },
    []
  )
  return useCallback(() => {
    if (!host) return () => {}
    const scope = new CommandFocusScopeState(host.rootScope, {
      element: () => null,
      active: () => true,
      context: () => ({ 'resource.focused': false }),
      boundary: true
    })
    const close = host.registry.openBoundary(scope)
    const dispose = () => {
      close()
      disposables.current.delete(dispose)
    }
    disposables.current.add(dispose)
    return dispose
  }, [host])
}
