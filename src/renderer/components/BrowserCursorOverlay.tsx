import { loggerService } from '@logger'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { BrowserCursorArrival, BrowserCursorState } from '@shared/types/browserCursor'
import type { WebviewTag } from 'electron'
import { MousePointer2 } from 'lucide-react'
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'

const logger = loggerService.withContext('BrowserCursorOverlay')

export function BrowserCursorOverlay({
  sessionId,
  tabId,
  guest,
  active
}: {
  sessionId: string
  tabId: string
  guest: WebviewTag
  active: boolean
}) {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const opacity = useMotionValue(0)
  const pulse = useMotionValue(1)
  const reducedMotion = useReducedMotion()
  const sequence = useRef(0)
  const pending = useRef<BrowserCursorArrival | undefined>(undefined)
  const movement = useRef<{ stop: () => void } | undefined>(undefined)
  const feedback = useRef<{ stop: () => void } | undefined>(undefined)
  const fade = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const positioned = useRef(false)

  const acknowledge = () => {
    if (!pending.current) return
    const arrival = pending.current
    pending.current = undefined
    void ipcApi.request('browser.cursor.arrive', arrival).catch((error) => {
      logger.debug('Cursor arrival target is unavailable', { error })
    })
  }
  const stop = () => {
    movement.current?.stop()
    feedback.current?.stop()
    clearTimeout(fade.current)
  }
  const hide = () => {
    stop()
    opacity.set(0)
    acknowledge()
  }

  useIpcOn('browser.cursor.state', (state: BrowserCursorState) => {
    if (state.sessionId !== sessionId || state.tabId !== tabId || state.sequence <= sequence.current) return
    sequence.current = state.sequence
    stop()
    acknowledge()
    if (state.kind === 'hidden') {
      opacity.set(0)
      return
    }
    if (state.kind === 'move' && state.animate)
      pending.current = { sessionId, tabId, sequence: state.sequence, documentId: state.documentId }
    const bounds = guest.getBoundingClientRect()
    if (!active || document.hidden || bounds.width <= 0 || bounds.height <= 0) {
      hide()
      return
    }
    const targetX = state.x * state.scale
    const targetY = state.y * state.scale
    const finish = () => {
      acknowledge()
      fade.current = setTimeout(() => {
        feedback.current = animate(opacity, 0, { duration: reducedMotion ? 0 : 0.15 })
      }, 900)
    }
    opacity.set(1)
    if (state.kind === 'pressed') {
      pulse.set(reducedMotion ? 1 : 0.8)
      feedback.current = animate(pulse, 1, { duration: reducedMotion ? 0 : 0.18 })
    }
    if (!positioned.current || !state.animate || reducedMotion || (x.get() === targetX && y.get() === targetY)) {
      x.set(targetX)
      y.set(targetY)
      positioned.current = true
      finish()
      return
    }
    const startX = x.get()
    const startY = y.get()
    movement.current = animate(0, 1, {
      duration: Math.min(0.18, Math.max(0.08, Math.hypot(targetX - startX, targetY - startY) / 2500)),
      ease: 'easeOut',
      onUpdate: (progress) => {
        x.set(startX + (targetX - startX) * progress)
        y.set(startY + (targetY - startY) * progress)
      },
      onComplete: finish
    })
  })

  useEffect(() => {
    void ipcApi.request('browser.cursor.present', { sessionId, tabId, presented: active }).catch((error) => {
      logger.debug('Cursor presentation target is unavailable', { error })
    })
    const observer = new ResizeObserver(hide)
    observer.observe(guest)
    guest.addEventListener('did-start-navigation', hide)
    window.addEventListener('blur', hide)
    return () => {
      hide()
      observer.disconnect()
      guest.removeEventListener('did-start-navigation', hide)
      window.removeEventListener('blur', hide)
      void ipcApi.request('browser.cursor.present', { sessionId, tabId, presented: false }).catch(() => undefined)
    }
    // Animation state is owned by this binding, not by each incoming event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, tabId, guest, active])

  return (
    <div
      aria-hidden="true"
      data-testid="browser-cursor-overlay"
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      <motion.div className="absolute top-0 left-0" style={{ x, y, opacity }}>
        <motion.div className="-translate-x-1 -translate-y-1" style={{ scale: pulse, transformOrigin: '4px 4px' }}>
          <MousePointer2 className="size-8 fill-primary stroke-primary-foreground drop-shadow-sm" strokeWidth={1.5} />
        </motion.div>
      </motion.div>
    </div>
  )
}
