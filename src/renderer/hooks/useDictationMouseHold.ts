import { useEffect } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import { dictationService, voiceTargetManager } from '@renderer/services/voice'
import { getDictationTarget } from '@renderer/utils/dictationTarget'

const HOLD_DELAY_MS = 800
const MOVE_TOLERANCE_PX = 6

export function useDictationMouseHold(): void {
  const [enabled] = usePreference('feature.voice.dictation.mouse_hold_enabled')

  useEffect(() => {
    if (!enabled) return
    let finish: (cancel?: boolean) => void = () => {}
    const pointerdown = (event: PointerEvent) => {
      finish()
      if (
        event.defaultPrevented ||
        event.pointerType !== 'mouse' ||
        !event.isPrimary ||
        event.button !== 0 ||
        event.buttons !== 1 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !(event.target instanceof Element) ||
        event.target.closest('a, button, select, [role="button"], [contenteditable="false"]')
      )
        return
      const target = getDictationTarget(event.target)
      if (!target) return
      const { targetId } = target
      let { input } = target
      if (!voiceTargetManager.markCurrent(targetId)) return
      const binding = voiceTargetManager.captureCurrent()
      if (!binding || binding.owner !== window) return
      const controller = new AbortController()
      const options = { signal: controller.signal }
      const capture = { ...options, capture: true }
      let run: ReturnType<typeof dictationService.startScoped> | undefined
      let unsubscribe: (() => void) | undefined
      const stop = () => finish()
      const pendingOnly = () => {
        if (!run) finish()
      }
      const pointermove = (move: PointerEvent) => {
        if (move.pointerId !== event.pointerId) return
        if (move.buttons !== 1) finish()
        else if (Math.hypot(move.clientX - event.clientX, move.clientY - event.clientY) > MOVE_TOLERANCE_PX)
          pendingOnly()
      }
      const pointerup = (up: PointerEvent) => {
        if (up.pointerId === event.pointerId) finish()
      }
      const mousedown = (down: MouseEvent) => {
        if (down.detail > 1) finish()
      }
      const blur = () => {
        // A composer can replace its editable element between blur and focusin.
        queueMicrotask(() => {
          if (!controller.signal.aborted && getDictationTarget(document.activeElement)?.targetId !== targetId) stop()
        })
      }
      const leave = (leaveEvent: PointerEvent) => {
        if (leaveEvent.target instanceof Element && leaveEvent.target.isConnected) pendingOnly()
      }
      const focusin = (focusEvent: FocusEvent) => {
        const focused = getDictationTarget(focusEvent.target instanceof Element ? focusEvent.target : null)
        if (focused?.targetId !== targetId) stop()
      }
      const selectionchange = () => {
        if (hasSelection()) pendingOnly()
      }
      const hasSelection = () =>
        input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement
          ? input.selectionStart !== input.selectionEnd
          : document.getSelection()?.isCollapsed === false
      const timer = setTimeout(() => {
        const focused = getDictationTarget(document.activeElement)
        if (!focused || focused.targetId !== targetId) {
          finish()
          return
        }
        if (focused.input !== input) {
          input = focused.input
          listenInput()
        }
        const snapshot = dictationService.getSnapshot()
        if (
          !input.isConnected ||
          document.hidden ||
          hasSelection() ||
          !['idle', 'failed'].includes(snapshot.phase) ||
          snapshot.retryAvailable ||
          snapshot.recoveryAvailable ||
          !voiceTargetManager.markCurrent(targetId) ||
          voiceTargetManager.captureCurrent()?.bindingToken !== binding.bindingToken
        ) {
          finish()
          return
        }
        run = dictationService.startScoped()
        void run.result.catch(() => undefined)
        unsubscribe = dictationService.subscribe(() => {
          const phase = dictationService.getSnapshot().phase
          if (phase !== 'starting' && phase !== 'recording') run = undefined
        })
      }, HOLD_DELAY_MS)

      window.addEventListener('pointermove', pointermove, capture)
      window.addEventListener('pointerup', pointerup, capture)
      window.addEventListener('pointercancel', pointerup, capture)
      window.addEventListener('blur', stop, options)
      window.addEventListener('focusin', focusin, capture)
      document.addEventListener('visibilitychange', stop, options)
      document.addEventListener('selectionchange', selectionchange, options)
      document.addEventListener('keydown', stop, capture)
      document.addEventListener('wheel', stop, capture)
      const listenInput = () => {
        input.addEventListener('pointerleave', leave, options)
        input.addEventListener('mousedown', mousedown, options)
        input.addEventListener('blur', blur, options)
        input.addEventListener('dragstart', stop, options)
        input.addEventListener('contextmenu', stop, options)
        input.addEventListener('beforeinput', stop, options)
        input.addEventListener('compositionstart', stop, options)
      }
      listenInput()
      finish = (cancel = false) => {
        clearTimeout(timer)
        unsubscribe?.()
        controller.abort()
        finish = () => {}
        if (run) void (cancel ? run.cancel() : run.stop()).catch(() => undefined)
      }
    }
    window.addEventListener('pointerdown', pointerdown)
    return () => {
      window.removeEventListener('pointerdown', pointerdown)
      finish(true)
    }
  }, [enabled])
}
