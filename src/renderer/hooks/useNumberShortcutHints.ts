import { useEffect, useMemo, useState } from 'react'

import { useCommandContextSnapshot, useCommandShortcutPreferences } from '@renderer/hooks/command'
import { getCommandShortcutLabel } from '@renderer/utils/command'
import { isMac, platform } from '@renderer/utils/platform'
import { type CommandId, getCommandDefaultShortcutPreference } from '@shared/utils/command'

export function useNumberShortcutHints(commands: readonly CommandId[], enabled = true) {
  const preferences = useCommandShortcutPreferences()
  const context = useCommandContextSnapshot()
  const [showHints, setShowHints] = useState(false)
  const supportedPlatform = platform === 'darwin' || platform === 'win32' || platform === 'linux' ? platform : undefined
  const preference = preferences[commands[0]] ?? getCommandDefaultShortcutPreference(commands[0], supportedPlatform)
  const modifier = preference?.binding[0] ?? 'CommandOrControl'
  const modifierKey = modifier === 'Alt' ? 'Alt' : modifier === 'Ctrl' ? 'Control' : isMac ? 'Meta' : 'Control'

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const reset = () => {
      clearTimeout(timer)
      timer = undefined
      setShowHints(false)
    }
    const keyDown = (event: KeyboardEvent) => {
      const primary = modifierKey === 'Meta' ? event.metaKey : modifierKey === 'Alt' ? event.altKey : event.ctrlKey
      if (!primary || (event.altKey && modifierKey !== 'Alt') || event.shiftKey || event.isComposing) {
        reset()
        return
      }
      if (event.key !== modifierKey || event.repeat || timer !== undefined) return
      timer = setTimeout(() => setShowHints(true), 500)
    }
    const keyUp = (event: KeyboardEvent) => {
      if (!(modifierKey === 'Meta' ? event.metaKey : modifierKey === 'Alt' ? event.altKey : event.ctrlKey)) reset()
    }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', reset)
    document.addEventListener('visibilitychange', reset)
    return () => {
      reset()
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', reset)
      document.removeEventListener('visibilitychange', reset)
    }
  }, [enabled, modifierKey])

  return useMemo(() => {
    const hints = new Map<CommandId, string>()
    if (!enabled || !showHints) return hints
    for (const command of commands) {
      const label = getCommandShortcutLabel(command, preferences[command], {
        context,
        isMac,
        platform: supportedPlatform
      })
      if (label) hints.set(command, label)
    }
    return hints
  }, [commands, context, enabled, preferences, showHints, supportedPlatform])
}
