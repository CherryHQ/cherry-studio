import { useCallback, useEffect, useRef, useState } from 'react'

/** Idle delay before the expanded painting prompt dock dims (see #20647). */
export const PROMPT_DOCK_IDLE_DELAY_MS = 3000

interface UsePromptDockAutoHideOptions {
  /** Only auto-dim when an expanded dock sits below generated images. */
  enabled: boolean
  /** Pauses the idle timer while typing/generating so Cancel stays reachable. */
  paused?: boolean
  delayMs?: number
}

/**
 * Dims the expanded painting prompt dock after a short idle period so the
 * generated image stays visually unobstructed (#20647). Activity inside the
 * dock (pointer move/down, focus, key input) restores full opacity; leaving
 * the dock or blurring restarts the timer. The dock itself keeps its solid
 * background — only its opacity changes, so text stays readable on hover.
 */
export function usePromptDockAutoHide({
  enabled,
  paused = false,
  delayMs = PROMPT_DOCK_IDLE_DELAY_MS
}: UsePromptDockAutoHideOptions) {
  const [idle, setIdle] = useState(false)
  const dockRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const scheduleIdle = useCallback(() => {
    clearTimer()
    if (!enabled || paused) return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      // Don't dim while focus is inside the dock (typing) — blur restarts it.
      const active = document.activeElement
      if (dockRef.current?.contains(active)) return
      setIdle(true)
    }, delayMs)
  }, [clearTimer, delayMs, enabled, paused])

  const markActive = useCallback(() => {
    clearTimer()
    setIdle(false)
    scheduleIdle()
  }, [clearTimer, scheduleIdle])

  // Reset when the dock (un)mounts or becomes (in)eligible; pause forces visible.
  useEffect(() => {
    if (!enabled || paused) {
      clearTimer()
      setIdle(false)
      return
    }
    setIdle(false)
    scheduleIdle()
    return clearTimer
  }, [clearTimer, enabled, paused, scheduleIdle])

  useEffect(() => clearTimer, [clearTimer])

  const setDockRef = useCallback(
    (el: HTMLDivElement | null) => {
      dockRef.current = el
      if (!el || !enabled || paused) return
      // A freshly expanded dock starts fully visible, then fades on idle.
      setIdle(false)
      scheduleIdle()
    },
    [enabled, paused, scheduleIdle]
  )

  return { dockRef: setDockRef, idle: enabled && !paused && idle, markActive, scheduleIdle }
}
