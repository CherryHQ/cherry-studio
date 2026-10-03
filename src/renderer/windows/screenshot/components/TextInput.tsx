/**
 * Floating textarea for the text annotation tool.
 *
 * IME-safe by construction rather than by platform branching: instead of reading
 * `textarea.value` (which contains uncommitted composition text such as raw pinyin),
 * the component keeps a separate "safe value" updated only by non-composing input,
 * and commits from that. After `compositionend` a pending flag blocks every input
 * event until the result is proven safe — by the deferred timer with a focus check,
 * by a non-composing keydown, or by the next composition starting. A blur rejects it.
 */

import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { useCallback, useEffect, useRef } from 'react'

import { ipcApi } from '@renderer/ipc'
import { isMac } from '@renderer/utils/platform'

import { Z_INDEX } from '../constants'
import type { Point, SelectionRect } from '../types'
import { getOverlayFontFamily, TEXT_LINE_HEIGHT } from '../utils/drawAnnotation'

interface TextInputProps {
  /** Image-absolute (viewport-relative) position of the editor's top-left corner. */
  position: Point
  /** Selection rect, used to clamp the editor's growth to the captured region. */
  selection: SelectionRect
  fontSize: number
  color: string
  onConfirm: (text: string) => void
  onCancel: () => void
  /** Published so the parent can commit the current text before repositioning. */
  flushRef: RefObject<(() => void) | null>
}

/**
 * How long to wait after `compositionend` before trusting the composed text, in ms.
 *
 * Shorter and the focus check below fires before focus has actually moved on slower
 * input methods; longer and a real interrupting click can beat the timer.
 */
const ACCEPT_DELAY_MS = 50

export function TextInput({ position, selection, fontSize, color, onConfirm, onCancel, flushRef }: TextInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /** Whether focus has landed at least once; guards against a blur that arrives first. */
  const focusedRef = useRef(false)
  /** Guards against committing twice when blur and an explicit flush race. */
  const committedRef = useRef(false)
  const isComposingRef = useRef(false)
  /**
   * Whether the overlay has already been stepped below the IME candidate window.
   *
   * Driven by the first composition rather than by the editor opening, so someone
   * typing without an IME never pays for this at all — the step-down uncovers the
   * Dock and the menu bar, which then take the clicks over the strips they occupy.
   * It is never undone mid-edit: restoring on `compositionend` would flash both of
   * them on and off between every word of a sentence.
   */
  const steppedDownRef = useRef(false)
  /** A composition ended and its result is not trusted yet. See the file header. */
  const pendingAcceptRef = useRef(false)
  const acceptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Last content known to exclude any active or pending composition. Commits read only this. */
  const safeValueRef = useRef('')
  // Refreshed every render so the native listeners below never call a stale callback.
  const onConfirmRef = useRef(onConfirm)
  const onCancelRef = useRef(onCancel)
  onConfirmRef.current = onConfirm
  onCancelRef.current = onCancel

  const doCommit = useCallback(() => {
    if (committedRef.current) return
    committedRef.current = true
    const text = safeValueRef.current.trim()
    if (text) {
      onConfirmRef.current(text)
    } else {
      onCancelRef.current()
    }
  }, [])

  /**
   * Restore the level when the editor closes, but only if a composition ever stepped
   * it down — see {@link steppedDownRef} for why the step-down is not done on mount.
   */
  useEffect(() => {
    if (!isMac) return
    return () => {
      if (!steppedDownRef.current) return
      void ipcApi.request('screenshot.text_editing', { editing: false })
    }
  }, [])

  // Focus next frame, not synchronously: the creating pointer event is still being handled and
  // its default handling would take focus straight back, leaving a box that swallows nothing.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      textareaRef.current?.focus()
      focusedRef.current = true
    })
    return () => cancelAnimationFrame(id)
  }, [])

  // Native listeners rather than React props: this depends on the exact ordering of input /
  // compositionend / blur, which React's delegated dispatch and microtask checkpoints may reorder.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return

    let windowPointerDownHandler: ((e: PointerEvent) => void) | null = null

    const removeWindowPointerDown = () => {
      if (windowPointerDownHandler) {
        window.removeEventListener('pointerdown', windowPointerDownHandler, true)
        windowPointerDownHandler = null
      }
    }

    const clearAcceptTimer = () => {
      if (acceptTimerRef.current !== null) {
        clearTimeout(acceptTimerRef.current)
        acceptTimerRef.current = null
      }
    }

    const acceptPending = () => {
      if (!pendingAcceptRef.current) return
      clearAcceptTimer()
      removeWindowPointerDown()
      safeValueRef.current = el.value
      pendingAcceptRef.current = false
    }

    const rejectPending = () => {
      if (!pendingAcceptRef.current) return
      clearAcceptTimer()
      removeWindowPointerDown()
      pendingAcceptRef.current = false
      // The textarea is uncontrolled, so React will never repaint it — restore the
      // clean text by hand or the user keeps staring at rejected composition text.
      el.value = safeValueRef.current
    }

    const onInput = (e: Event) => {
      // Chromium fires a non-composing input right after compositionend carrying the
      // raw composition text. Letting it through here bypasses every other defence.
      if (pendingAcceptRef.current) return
      if (!(e as InputEvent).isComposing && !isComposingRef.current) {
        safeValueRef.current = el.value
      }
    }

    const onCompositionStart = () => {
      // The candidate window sits below the overlay's level; step down once, on the
      // first composition, so this costs nothing for a user with no IME.
      if (isMac && !steppedDownRef.current) {
        steppedDownRef.current = true
        void ipcApi.request('screenshot.text_editing', { editing: true })
      }
      // A new composition proves focus never left, so the previous result is good.
      // Without this, two IME words typed within the accept delay lose the first.
      acceptPending()
      safeValueRef.current = el.value
      isComposingRef.current = true
    }

    const onCompositionEnd = () => {
      isComposingRef.current = false
      pendingAcceptRef.current = true

      // Capture phase: toolbar, panel and canvas all stopPropagation on pointerdown, so a bubble
      // probe would miss the interrupting click. Picking an OS candidate fires no DOM pointerdown.
      removeWindowPointerDown()
      windowPointerDownHandler = (e: PointerEvent) => {
        // A click on the textarea itself only moves the caret; it is not an interruption.
        if (e.target === el) return
        rejectPending()
      }
      window.addEventListener('pointerdown', windowPointerDownHandler, true)

      // `compositionend` also fires when the element is LOSING focus and the input method flushes;
      // the delayed activeElement check separates "picked a candidate" from "clicked away".
      acceptTimerRef.current = setTimeout(() => {
        acceptTimerRef.current = null
        removeWindowPointerDown()
        if (pendingAcceptRef.current && document.activeElement === el) {
          safeValueRef.current = el.value
          pendingAcceptRef.current = false
        }
      }, ACCEPT_DELAY_MS)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || isComposingRef.current) return
      // Typing anything non-composing proves the user is still here, so trust the
      // pending result immediately instead of waiting out the timer and losing it.
      acceptPending()
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancelRef.current()
      }
    }

    const onBlur = () => {
      if (!focusedRef.current) return
      rejectPending()
      doCommit()
    }

    el.addEventListener('input', onInput)
    el.addEventListener('compositionstart', onCompositionStart)
    el.addEventListener('compositionend', onCompositionEnd)
    el.addEventListener('keydown', onKeyDown)
    el.addEventListener('blur', onBlur)

    return () => {
      el.removeEventListener('input', onInput)
      el.removeEventListener('compositionstart', onCompositionStart)
      el.removeEventListener('compositionend', onCompositionEnd)
      el.removeEventListener('keydown', onKeyDown)
      el.removeEventListener('blur', onBlur)
      removeWindowPointerDown()
      clearAcceptTimer()
    }
  }, [doCommit])

  useEffect(() => {
    flushRef.current = doCommit
    return () => {
      flushRef.current = null
    }
  }, [flushRef, doCommit])

  const maxWidth = selection.x + selection.width - position.x
  const maxHeight = selection.y + selection.height - position.y

  return (
    <textarea
      ref={textareaRef}
      className="absolute resize-none outline-none"
      spellCheck={false}
      style={{
        zIndex: Z_INDEX.TEXT_INPUT,
        left: position.x,
        top: position.y,
        margin: 0,
        padding: 0,
        border: 'none',
        fontSize,
        // Same resolved stack the canvas renderer uses, so the committed text lands
        // exactly where the editor showed it.
        fontFamily: getOverlayFontFamily(),
        lineHeight: TEXT_LINE_HEIGHT,
        color,
        background: 'transparent',
        outline: '2px dashed rgba(128, 128, 128, 0.8)',
        outlineOffset: 1,
        borderRadius: 2,
        fieldSizing: 'content',
        maxWidth,
        maxHeight,
        minWidth: 2,
        minHeight: fontSize * TEXT_LINE_HEIGHT,
        wordBreak: 'break-all',
        overflow: 'hidden',
        caretColor: color
      }}
      // Clicking inside the box would otherwise start a background selection on the
      // canvas underneath and destroy the editor mid-sentence.
      onPointerDown={(e: ReactPointerEvent) => e.stopPropagation()}
    />
  )
}
