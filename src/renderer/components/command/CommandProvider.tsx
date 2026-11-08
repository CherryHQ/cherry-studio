import { type ReactNode, useEffect, useMemo, useRef } from 'react'

import { KeyboardLayerProvider } from '@cherrystudio/ui'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import {
  type CommandHandler,
  CommandRuntimeContext,
  type CommandRuntime,
  runCommandHandler,
  type CommandSharedPreferences,
  CommandSharedPreferencesContext,
  useCommandContextSnapshot
} from '@renderer/hooks/command'
import {
  CommandFocusHostContext,
  CommandFocusRegistry,
  CommandFocusScopeContext,
  CommandFocusScopeState,
  findScopeHandler,
  readScopeContext,
  readRegisteredHandler
} from '@renderer/hooks/command'
import { platform } from '@renderer/utils/platform'
import type { ContextReader, SupportedPlatform } from '@shared/types/command'
import { type CommandId, REGISTERED_KEYBINDINGS, resolveCommandByKeybinding } from '@shared/utils/command'
import { getShortcutBindingFromKeyboardEvent } from '@shared/utils/shortcut'

import { CommandKeyboardLayer } from './CommandFocusScope'

const logger = loggerService.withContext('CommandProvider')

function isEditableEvent(event: KeyboardEvent): boolean {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) continue
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)) return true
    const editable = node.getAttribute('contenteditable')
    if (editable === 'false') return false
    if (node.isContentEditable || editable === '' || editable === 'true' || editable === 'plaintext-only') return true
  }
  return false
}

const shortcutPreferenceKeys = Object.fromEntries(
  REGISTERED_KEYBINDINGS.map((rule) => [rule.command, rule.preferenceKey])
) as Record<CommandId, (typeof REGISTERED_KEYBINDINGS)[number]['preferenceKey']>

export function CommandProvider({ children }: { children: ReactNode }) {
  const contextSnapshot = useCommandContextSnapshot()
  const [shortcutPreferences] = useMultiplePreferences(shortcutPreferenceKeys)
  const [menuPresentationMode] = usePreference('menu.presentation_mode')
  const stateRef = useRef({ context: contextSnapshot, shortcutPreferences })
  stateRef.current = { context: contextSnapshot, shortcutPreferences }

  const host = useMemo(() => {
    const rootScope = new CommandFocusScopeState(null, { element: () => null, active: () => true, context: () => ({}) })
    const registry = new CommandFocusRegistry()
    const forScope = (scope: CommandFocusScopeState): CommandRuntime => ({
      registerHandler: (command, handler, options) => scope.registerHandler(command, handler, options),
      hasHandler: (command) => Boolean(findScopeHandler(scope, command)),
      execute: (command, args) => {
        const entry = findScopeHandler(scope, command)
        if (entry) runCommandHandler(command, readRegisteredHandler(entry), args)
        else logger.warn(`No renderer command handler registered: ${command}`)
      }
    })
    return { rootScope, registry, forScope }
  }, [])
  const runtime = useMemo(() => host.forScope(host.rootScope), [host])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return
      const editable = isEditableEvent(event)
      if (!(event.ctrlKey || event.metaKey || event.altKey) && editable) return
      const scope = host.registry.resolve(event, host.rootScope)
      const base = readScopeContext(scope, stateRef.current.context)
      const context: ContextReader = (key) =>
        key === 'input.focused' ? editable : typeof base === 'function' ? base(key) : undefined
      const candidates = new Map<
        CommandId,
        { entry: NonNullable<ReturnType<typeof findScopeHandler>>; handler: CommandHandler }
      >()
      const command = resolveCommandByKeybinding({
        binding: getShortcutBindingFromKeyboardEvent(event, platform as SupportedPlatform),
        preferences: stateRef.current.shortcutPreferences,
        context,
        platform: platform as SupportedPlatform,
        scope: 'renderer',
        canExecuteCommand: (id) => {
          const entry = findScopeHandler(scope, id)
          if (entry) candidates.set(id, { entry, handler: readRegisteredHandler(entry) })
          return Boolean(entry)
        }
      })
      if (!command) return
      const candidate = candidates.get(command)
      if (!candidate || candidate.entry.options.shouldHandleKeyEvent?.(event) === false) return
      event.preventDefault()
      runCommandHandler(command, candidate.handler)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [host])

  const sharedPreferences = useMemo<CommandSharedPreferences>(
    () => ({ shortcutPreferences, menuPresentationMode }),
    [shortcutPreferences, menuPresentationMode]
  )
  return (
    <CommandFocusHostContext value={host}>
      <CommandFocusScopeContext value={host.rootScope}>
        <CommandRuntimeContext value={runtime}>
          <CommandSharedPreferencesContext value={sharedPreferences}>
            <KeyboardLayerProvider adapter={CommandKeyboardLayer}>{children}</KeyboardLayerProvider>
          </CommandSharedPreferencesContext>
        </CommandRuntimeContext>
      </CommandFocusScopeContext>
    </CommandFocusHostContext>
  )
}
