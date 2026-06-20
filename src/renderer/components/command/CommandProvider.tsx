import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { platform } from '@renderer/config/constant'
import {
  type CommandHandler,
  type CommandHandlerOptions,
  CommandRuntimeContext,
  type CommandSharedPreferences,
  CommandSharedPreferencesContext,
  useCommandContextSnapshot
} from '@renderer/hooks/command'
import { getShortcutBindingFromKeyboardEvent } from '@renderer/utils/command'
import {
  type CommandId,
  type ContextReader,
  type MenuPresentationMode,
  REGISTERED_KEYBINDINGS,
  resolveCommandByKeybinding,
  type SupportedPlatform
} from '@shared/command'
import type { PreferenceShortcutType } from '@shared/data/preference/preferenceTypes'
import React, { useCallback, useEffect, useMemo, useRef } from 'react'

const logger = loggerService.withContext('CommandProvider')

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

/**
 * True when the event target is a text-entry surface — an `<input>`,
 * `<textarea>`, or any element with `contenteditable`. Used to suppress
 * no-modifier shortcuts so plain keys (Escape, single letters) don't hijack
 * typing.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tagName = target.tagName
  if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
    return true
  }
  // `isContentEditable` reflects the inherited editing state in real browsers;
  // the attribute fallback covers environments (jsdom) that don't compute it.
  return target.isContentEditable || target.getAttribute('contenteditable') === 'true'
}

const shortcutPreferenceKeys = Object.fromEntries(
  REGISTERED_KEYBINDINGS.map((rule) => [rule.command, rule.preferenceKey])
) as Record<CommandId, (typeof REGISTERED_KEYBINDINGS)[number]['preferenceKey']>

export function CommandProvider({ children }: { children: React.ReactNode }) {
  const contextSnapshot = useCommandContextSnapshot()
  const [shortcutPreferences] = useMultiplePreferences(shortcutPreferenceKeys)
  const [menuPresentationMode] = usePreference('menu.presentation_mode')

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

      // Skip no-modifier shortcuts while an editable target is focused so plain
      // keys (Escape, single letters) don't hijack typing. Modifier combos
      // (Ctrl/Meta/Alt) still fire everywhere; Shift alone does not count.
      const hasModifier = event.ctrlKey || event.metaKey || event.altKey
      if (!hasModifier && isEditableTarget(event.target)) {
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

  const sharedPreferences = useMemo<CommandSharedPreferences>(
    () => ({
      shortcutPreferences: shortcutPreferences as Partial<Record<CommandId, PreferenceShortcutType>>,
      menuPresentationMode: menuPresentationMode as MenuPresentationMode | undefined
    }),
    [shortcutPreferences, menuPresentationMode]
  )

  return (
    <CommandRuntimeContext value={value}>
      <CommandSharedPreferencesContext value={sharedPreferences}>{children}</CommandSharedPreferencesContext>
    </CommandRuntimeContext>
  )
}
