import { use, useEffect, useRef } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import { CommandSharedPreferencesContext, useCommandContextSnapshot } from '@renderer/hooks/command'
import { dictationService, voiceTargetManager } from '@renderer/services/voice'
import {
  dictationShortcutMatches,
  dictationShortcutsConflict,
  hasDictationCommandConflict,
  isDictationShortcutModifier,
  parseDictationShortcut
} from '@renderer/utils/dictationShortcut'
import { isMac, isWin } from '@renderer/utils/platform'
import type { SupportedPlatform } from '@shared/types/command'

const HOLD_DELAY_MS = 300

export function useDictationShortcuts(): void {
  const [hold] = usePreference('feature.voice.dictation.hold_shortcut')
  const [toggle] = usePreference('feature.voice.dictation.toggle_shortcut')
  const preferences = use(CommandSharedPreferencesContext)?.shortcutPreferences
  const context = useCommandContextSnapshot()
  const platform: SupportedPlatform = isMac ? 'darwin' : isWin ? 'win32' : 'linux'
  const commandState = useRef({ preferences, context, platform })
  commandState.current = { preferences, context, platform }

  useEffect(() => {
    if (dictationShortcutsConflict(hold, toggle)) return
    const pressed = new Set<string>()
    const consumed = new Set<string>()
    const clearNonModifiers = () => {
      for (const code of pressed) if (!isDictationShortcutModifier(code)) pressed.delete(code)
    }
    const holdCodes = parseDictationShortcut(hold)
    const toggleCodes = parseDictationShortcut(toggle)
    // Lightweight windows do not mount a renderer command dispatcher.
    const available = (shortcut: string) =>
      !commandState.current.preferences || !hasDictationCommandConflict(shortcut, commandState.current)
    const matches = (shortcut: string) => dictationShortcutMatches(shortcut, pressed) && available(shortcut)
    const isCompletingToggle = () =>
      available(toggle) &&
      pressed.size < toggleCodes.length &&
      holdCodes.every((code) => pressed.has(code)) &&
      [...pressed].every((code) => toggleCodes.includes(code))
    let timer: ReturnType<typeof setTimeout> | undefined
    let owned:
      | { run: ReturnType<typeof dictationService.startScoped>; mode: 'hold' | 'toggle'; ready: boolean }
      | undefined
    const unsubscribe = dictationService.subscribe(() => {
      const phase = dictationService.getSnapshot().phase
      if (owned && ((phase !== 'starting' && phase !== 'recording') || (phase === 'starting' && owned.ready)))
        owned = undefined
    })

    const clearTimer = () => {
      clearTimeout(timer)
      timer = undefined
    }
    const stopOwned = () => {
      const previous = owned
      owned = undefined
      void previous?.run.stop().catch(() => undefined)
    }
    const activateFocusedTarget = () => {
      const element = document.activeElement
      const surface = element?.closest('[data-voice-target-id]')
      const targetId = surface?.getAttribute('data-voice-target-id')
      if (!(element instanceof HTMLElement) || !surface || !targetId) return false
      return (
        ((element.isContentEditable &&
          (surface === element || surface.querySelector('[contenteditable="true"]') === element)) ||
          (surface === element &&
            element.matches('textarea:not(:disabled):not([readonly]), input:not(:disabled):not([readonly])'))) &&
        voiceTargetManager.markCurrent(targetId) &&
        voiceTargetManager.captureCurrent()?.owner === window
      )
    }
    const start = (mode: 'hold' | 'toggle') => {
      const snapshot = dictationService.getSnapshot()
      if (
        !available(mode === 'hold' ? hold : toggle) ||
        !activateFocusedTarget() ||
        owned ||
        !['idle', 'failed'].includes(snapshot.phase) ||
        snapshot.retryAvailable ||
        snapshot.recoveryAvailable
      )
        return
      const run = dictationService.startScoped()
      owned = { run, mode, ready: false }
      void run.result
        .catch(() => undefined)
        .finally(() => {
          if (owned?.run !== run) return
          if (dictationService.getSnapshot().phase !== 'recording') owned = undefined
          else owned.ready = true
        })
    }
    const consume = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.type === 'keydown' && !event.repeat) for (const code of pressed) consumed.add(code)
    }
    const keydown = (event: KeyboardEvent) => {
      // A fresh press ends ownership if its previous release happened outside this window.
      if (!event.repeat) consumed.delete(event.code)
      if (event.isComposing || event.defaultPrevented) return
      if (event.repeat) {
        if (consumed.has(event.code)) consume(event)
        return
      }
      // Recover modifiers whose release never reached this window.
      for (const code of pressed) {
        if (!isDictationShortcutModifier(code)) continue
        const modifier = code.replace(/(Left|Right)$/, '')
        // AltGraph can replace the Control/Alt flags while both physical keys remain held.
        if (event.getModifierState('AltGraph') && (modifier === 'Control' || modifier === 'Alt')) continue
        if (!event.getModifierState(modifier)) pressed.delete(code)
      }
      if (isMac && event.metaKey && !isDictationShortcutModifier(event.code)) clearNonModifiers()
      pressed.add(event.code)
      clearTimer()
      if (matches(toggle) && (owned || activateFocusedTarget())) {
        consume(event)
        if (owned?.mode === 'hold') owned.mode = 'toggle'
        else if (owned) stopOwned()
        else start('toggle')
        return
      }
      if (owned?.mode === 'hold' && !matches(hold)) {
        if (isCompletingToggle()) {
          consume(event)
        } else stopOwned()
      }
      if (matches(hold) && activateFocusedTarget()) {
        consume(event)
        timer = setTimeout(() => start('hold'), HOLD_DELAY_MS)
      }
    }
    const keyup = (event: KeyboardEvent) => {
      if (consumed.delete(event.code)) consume(event)
      pressed.delete(event.code)
      // macOS can omit character keyups while Command is held.
      if (isMac && event.code.startsWith('Meta')) clearNonModifiers()
      clearTimer()
      if (owned?.mode === 'hold' && !matches(hold) && !isCompletingToggle()) {
        stopOwned()
      }
    }
    const reset = () => {
      pressed.clear()
      clearTimer()
      stopOwned()
    }
    const focusout = () => {
      clearTimer()
      if (owned?.mode === 'hold') stopOwned()
    }
    const visibility = () => {
      if (document.hidden) reset()
    }
    window.addEventListener('keydown', keydown, true)
    window.addEventListener('keyup', keyup, true)
    window.addEventListener('blur', reset)
    window.addEventListener('focusout', focusout)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      unsubscribe()
      clearTimer()
      void owned?.run.cancel().catch(() => undefined)
      window.removeEventListener('keydown', keydown, true)
      window.removeEventListener('keyup', keyup, true)
      window.removeEventListener('blur', reset)
      window.removeEventListener('focusout', focusout)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [hold, toggle])
}
