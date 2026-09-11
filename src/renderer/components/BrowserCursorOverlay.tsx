import type { WebviewTag } from 'electron'
import { useEffect, useRef } from 'react'

import { loggerService } from '@logger'
import cursorImage from '@renderer/assets/images/browser-cursor.png?inline'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { BrowserCursorArrival, BrowserCursorState } from '@shared/types/browserCursor'

import { BrowserCursorAnimation } from './BrowserCursorAnimation'

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
  const position = useRef<HTMLDivElement>(null)
  const sprite = useRef<HTMLImageElement>(null)
  const animation = useRef<BrowserCursorAnimation | undefined>(undefined)
  const reducedMotion = useRef(false)
  const sequence = useRef(0)
  const pending = useRef<BrowserCursorArrival | undefined>(undefined)

  const acknowledge = () => {
    if (!pending.current) return
    const arrival = pending.current
    pending.current = undefined
    void ipcApi.request('browser.cursor.arrive', arrival).catch((error) => {
      logger.debug('Cursor arrival target is unavailable', { error })
    })
  }

  useIpcOn('browser.cursor.state', (state: BrowserCursorState) => {
    if (state.sessionId !== sessionId || state.tabId !== tabId || state.sequence <= sequence.current) return
    sequence.current = state.sequence
    acknowledge()
    if (state.kind === 'hidden') {
      animation.current?.hide()
      return
    }
    if (state.kind === 'move' && state.animate)
      pending.current = { sessionId, tabId, sequence: state.sequence, documentId: state.documentId }
    const bounds = guest.getBoundingClientRect()
    if (!active || document.hidden || bounds.width <= 0 || bounds.height <= 0 || !animation.current) {
      animation.current?.hide(true)
      acknowledge()
      return
    }
    animation.current.move(
      state.x * state.scale,
      state.y * state.scale,
      bounds.width,
      bounds.height,
      state.animate,
      reducedMotion.current,
      state.kind === 'pressed'
    )
  })

  useEffect(() => {
    if (!position.current || !sprite.current) return
    const controller = new BrowserCursorAnimation(position.current, sprite.current, acknowledge)
    animation.current = controller
    const hide = () => {
      controller.hide(true)
      acknowledge()
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotion = () => {
      reducedMotion.current = media.matches
      hide()
    }
    updateMotion()
    media.addEventListener('change', updateMotion)
    void ipcApi.request('browser.cursor.present', { sessionId, tabId, presented: active }).catch((error) => {
      logger.debug('Cursor presentation target is unavailable', { error })
    })
    const observer = new ResizeObserver(hide)
    observer.observe(guest)
    guest.addEventListener('did-start-navigation', hide)
    window.addEventListener('blur', hide)
    document.addEventListener('visibilitychange', hide)
    return () => {
      hide()
      controller.dispose()
      animation.current = undefined
      observer.disconnect()
      media.removeEventListener('change', updateMotion)
      guest.removeEventListener('did-start-navigation', hide)
      window.removeEventListener('blur', hide)
      document.removeEventListener('visibilitychange', hide)
      void ipcApi.request('browser.cursor.present', { sessionId, tabId, presented: false }).catch(() => undefined)
    }
    // The animation belongs to this guest binding, not to individual IPC events.
  }, [sessionId, tabId, guest, active])

  return (
    <div
      aria-hidden="true"
      data-testid="browser-cursor-overlay"
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      <div ref={position} className="absolute top-0 left-0 opacity-0 will-change-transform">
        <img
          ref={sprite}
          src={cursorImage}
          alt=""
          draggable={false}
          width={46}
          height={48}
          className="-top-1 -left-[23px] absolute max-w-none origin-[23px_4px] will-change-transform"
        />
      </div>
    </div>
  )
}
