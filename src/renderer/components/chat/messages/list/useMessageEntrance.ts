import { createContext, useCallback, useLayoutEffect, useMemo, useState } from 'react'

const ENTRANCE_START_TIMEOUT_MS = 2500
const ENTRANCE_WINDOW_MS = 650
const BLOCK_DELAY_MS = 30
const MAX_BLOCK_DELAY_MS = 270
const ENTRANCE_ANIMATION_ID = 'chat-message-entrance'
const MESSAGE = '[data-message-id]'
const MARKDOWN_BLOCKS = '[data-message-entrance-markdown]'
const CONTENT_UNITS = `[data-message-entrance-unit],${MARKDOWN_BLOCKS}`
const CLIPPING_OVERFLOW = /^(auto|scroll|hidden|clip)$/
const captureRoots = new WeakMap<Element, number>()

interface MessageEntrance {
  registerMarkdownBlocks(blocks: HTMLCollection): void
  excludeMessage(id: string, element: Element | null): void
}

export const MessageEntranceContext = createContext<MessageEntrance | undefined>(undefined)

function cancelMessageEntrance(root: Element | null) {
  for (const animation of root?.getAnimations?.({ subtree: true }) ?? []) {
    if (animation.id === ENTRANCE_ANIMATION_ID) animation.cancel()
  }
}

export function suppressMessageEntrance(root: Element) {
  captureRoots.set(root, (captureRoots.get(root) ?? 0) + 1)
  cancelMessageEntrance(root)
  return () => {
    const remaining = (captureRoots.get(root) ?? 1) - 1
    if (remaining) captureRoots.set(root, remaining)
    else captureRoots.delete(root)
  }
}

function isVisible(
  element: Element,
  viewport: Element,
  bounds: DOMRect,
  getClipBounds: (ancestor: Element) => Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'> | undefined
) {
  const rect = element.getBoundingClientRect()
  let left = Math.max(rect.left, bounds.left)
  let right = Math.min(rect.right, bounds.right)
  let top = Math.max(rect.top, bounds.top)
  let bottom = Math.min(rect.bottom, bounds.bottom)
  if (left >= right || top >= bottom || captureRoots.has(element)) return false
  if (/^(hidden|collapse)$/.test(getComputedStyle(element).visibility)) return false

  for (let parent = element.parentElement; parent && parent !== viewport; parent = parent.parentElement) {
    if (captureRoots.has(parent)) return false
    const clip = getClipBounds(parent)
    if (!clip) continue
    left = Math.max(left, clip.left)
    right = Math.min(right, clip.right)
    top = Math.max(top, clip.top)
    bottom = Math.min(bottom, clip.bottom)
    if (left >= right || top >= bottom) return false
  }
  return true
}

function getContentBlocks(message: Element) {
  const occurrences = new Map<string, number>()
  return Array.from(message.querySelectorAll(CONTENT_UNITS)).flatMap((unit) => {
    if (unit.closest(MESSAGE) !== message || unit.parentElement?.closest(CONTENT_UNITS)) return []
    const markdown = unit.matches(MARKDOWN_BLOCKS)
      ? unit
      : unit.hasAttribute('data-message-part-id')
        ? unit.querySelector(MARKDOWN_BLOCKS)
        : null
    const partId = unit.getAttribute('data-message-part-id')
    const unitId = unit.getAttribute('data-message-entrance-unit')
    return Array.from(markdown ? markdown.children : [unit], (block) => {
      const fingerprint = unitId
        ? JSON.stringify([unitId])
        : JSON.stringify([
            partId,
            block.tagName,
            block.textContent,
            Array.from(block.querySelectorAll('img, video'), (media) => media.getAttribute('src'))
          ])
      const occurrence = (occurrences.get(fingerprint) ?? 0) + 1
      occurrences.set(fingerprint, occurrence)
      return { block, key: `${fingerprint}:${occurrence}` }
    })
  })
}

export function useMessageEntrance(enabled: boolean, viewport: HTMLDivElement | null, initialScrollSettled: boolean) {
  const [session] = useState(() => ({
    deadline: performance.now() + ENTRANCE_START_TIMEOUT_MS,
    started: false,
    excluded: new Set<string>(),
    played: new Map<string, Set<string>>(),
    playedElements: new WeakSet<Element>(),
    disconnect: undefined as (() => void) | undefined
  }))
  const entrance = useMemo<MessageEntrance>(
    () => ({
      registerMarkdownBlocks(blocks) {
        if (performance.now() < session.deadline) {
          blocks[0]?.parentElement?.setAttribute('data-message-entrance-markdown', '')
        }
      },
      excludeMessage(id, element) {
        if (session.excluded.has(id)) return
        if (performance.now() < session.deadline) session.excluded.add(id)
        if (session.played.has(id)) cancelMessageEntrance(element)
      }
    }),
    [session]
  )
  const stopEntrance = useCallback(() => {
    if (session.started && session.deadline > 0) cancelMessageEntrance(viewport)
    session.deadline = 0
    session.disconnect?.()
  }, [session, viewport])

  useLayoutEffect(() => {
    if (!viewport || !initialScrollSettled) return
    if (!enabled) {
      if (session.started) cancelMessageEntrance(viewport)
      return
    }
    if (performance.now() >= session.deadline) return
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let frame = 0
    let timeout = 0
    const closeWindow = () => {
      mutationObserver.disconnect()
      resizeObserver?.disconnect()
      viewport.removeEventListener('scroll', schedule, true)
      cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
    }
    const collectVisibleBlocks = () => {
      frame = 0
      const now = performance.now()
      if (now >= session.deadline) return
      const viewportRect = viewport.getBoundingClientRect()
      if (!viewportRect.width || !viewportRect.height) return

      const clips = new Map<Element, Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'> | undefined>()
      const getClipBounds = (ancestor: Element) => {
        if (clips.has(ancestor)) return clips.get(ancestor)
        const style = getComputedStyle(ancestor)
        const clipsX = CLIPPING_OVERFLOW.test(style.overflowX || style.overflow)
        const clipsY = CLIPPING_OVERFLOW.test(style.overflowY || style.overflow)
        if (!clipsX && !clipsY) {
          clips.set(ancestor, undefined)
          return
        }
        resizeObserver?.observe(ancestor)
        const rect = ancestor.getBoundingClientRect()
        const left = rect.left + ancestor.clientLeft
        const top = rect.top + ancestor.clientTop
        const clip = {
          left: clipsX ? left : -Infinity,
          right: clipsX ? left + ancestor.clientWidth : Infinity,
          top: clipsY ? top : -Infinity,
          bottom: clipsY ? top + ancestor.clientHeight : Infinity
        }
        clips.set(ancestor, clip)
        return clip
      }
      const visibleInViewport = (element: Element) => isVisible(element, viewport, viewportRect, getClipBounds)

      let hasVisibleContent = false
      let messageIndex = 0
      for (const message of viewport.querySelectorAll<HTMLElement>(MESSAGE)) {
        const id = message.dataset.messageId
        if (!id || message.closest('[data-message-virtual-list-scroller]') !== viewport) continue
        if (!visibleInViewport(message)) continue
        if (session.excluded.has(id)) {
          hasVisibleContent = true
          continue
        }
        const played = session.played.get(id) ?? new Set<string>()
        const visible = getContentBlocks(message).filter(
          ({ block, key }) => !session.playedElements.has(block) && !played.has(key) && visibleInViewport(block)
        )
        if (!visible.length) continue
        hasVisibleContent = true
        const interval = Math.min(BLOCK_DELAY_MS, MAX_BLOCK_DELAY_MS / Math.max(1, visible.length - 1))
        const messageDelay = (messageIndex++ % 4) * 10
        for (const [order, { block, key }] of visible.entries()) {
          block.animate?.(
            [
              { opacity: 0, translate: '0 -4px' },
              { opacity: 1, translate: 'none' }
            ],
            {
              id: ENTRANCE_ANIMATION_ID,
              duration: 180,
              delay: messageDelay + order * interval,
              easing: 'ease-out',
              fill: 'backwards'
            }
          )
          session.playedElements.add(block)
          played.add(key)
        }
        session.played.set(id, played)
      }
      if (hasVisibleContent && !session.started) {
        session.started = true
        session.deadline = now + ENTRANCE_WINDOW_MS
        window.clearTimeout(timeout)
        timeout = window.setTimeout(closeWindow, ENTRANCE_WINDOW_MS)
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(collectVisibleBlocks)
    }
    const disableMotion = () => {
      if (preference?.matches) stopEntrance()
    }
    const mutationObserver = new MutationObserver(schedule)
    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    session.disconnect = closeWindow
    preference?.addEventListener('change', disableMotion)
    if (preference?.matches) stopEntrance()
    else {
      // Virtua reveals unmeasured rows by changing their inline visibility.
      mutationObserver.observe(viewport, {
        childList: true,
        characterData: true,
        attributeFilter: ['style', 'class', 'data-message-entrance-markdown'],
        subtree: true
      })
      resizeObserver?.observe(viewport)
      viewport.addEventListener('scroll', schedule, { capture: true, passive: true })
      collectVisibleBlocks()
      if (!timeout) {
        timeout = window.setTimeout(closeWindow, Math.max(0, session.deadline - performance.now()))
      }
    }
    return () => {
      closeWindow()
      preference?.removeEventListener('change', disableMotion)
      session.disconnect = undefined
    }
  }, [enabled, initialScrollSettled, session, stopEntrance, viewport])

  return { entrance: enabled ? entrance : undefined, stopEntrance }
}
