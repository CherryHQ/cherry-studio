import { useEffect } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import { dictationService, voiceTargetManager } from '@renderer/services/voice'
import { dictationShortcutMatches } from '@renderer/utils/dictationShortcut'

const HOLD_DELAY_MS = 300

export function useDictationShortcuts(): void {
  const [hold] = usePreference('feature.voice.dictation.hold_shortcut')
  const [toggle] = usePreference('feature.voice.dictation.toggle_shortcut')

  useEffect(() => {
    const pressed = new Set<string>()
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
    const canStart = () => {
      const element = document.activeElement
      const target = voiceTargetManager.captureCurrent()
      const surface = element?.closest('[data-voice-target-id]')
      return (
        target?.owner === window &&
        element instanceof HTMLElement &&
        surface?.getAttribute('data-voice-target-id') === target.targetId &&
        ((element.isContentEditable &&
          (surface === element || surface.querySelector('[contenteditable="true"]') === element)) ||
          (surface === element &&
            element.matches('textarea:not(:disabled):not([readonly]), input:not(:disabled):not([readonly])')))
      )
    }
    const start = (mode: 'hold' | 'toggle') => {
      if (
        !canStart() ||
        owned ||
        !['idle', 'failed'].includes(dictationService.getSnapshot().phase) ||
        dictationService.getSnapshot().retryAvailable
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
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || event.defaultPrevented) return
      pressed.add(event.code)
      clearTimer()
      if (dictationShortcutMatches(toggle, pressed) && (owned || canStart())) {
        event.preventDefault()
        event.stopPropagation()
        if (owned?.mode === 'hold') owned.mode = 'toggle'
        else if (owned) stopOwned()
        else if (dictationService.getSnapshot().phase === 'recording')
          void dictationService.stop().catch(() => undefined)
        else start('toggle')
        return
      }
      if (owned?.mode === 'hold' && !dictationShortcutMatches(hold, pressed)) stopOwned()
      if (dictationShortcutMatches(hold, pressed) && canStart()) {
        event.preventDefault()
        timer = setTimeout(() => start('hold'), HOLD_DELAY_MS)
      }
    }
    const keyup = (event: KeyboardEvent) => {
      pressed.delete(event.code)
      clearTimer()
      if (owned?.mode === 'hold' && !dictationShortcutMatches(hold, pressed)) {
        event.preventDefault()
        stopOwned()
      }
    }
    const reset = () => {
      pressed.clear()
      clearTimer()
      stopOwned()
    }
    const visibility = () => {
      if (document.hidden) reset()
    }
    window.addEventListener('keydown', keydown, true)
    window.addEventListener('keyup', keyup, true)
    window.addEventListener('blur', reset)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      unsubscribe()
      clearTimer()
      void owned?.run.cancel().catch(() => undefined)
      window.removeEventListener('keydown', keydown, true)
      window.removeEventListener('keyup', keyup, true)
      window.removeEventListener('blur', reset)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [hold, toggle])
}
