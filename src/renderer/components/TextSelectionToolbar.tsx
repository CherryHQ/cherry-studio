import { Copy, Quote } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Popover, PopoverAnchor, PopoverContent } from '@cherrystudio/ui'

interface TextSelectionToolbarProps {
  children: ReactNode
  onCopy: (selection: Selection) => void
  onQuote: (selection: Selection) => void
}

const SCOPE_SELECTOR = '[data-selection-actions-scope]'
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'

export function TextSelectionToolbar({ children, onCopy, onQuote }: TextSelectionToolbarProps) {
  const { t } = useTranslation()
  const scopeRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const virtualRef = useMemo(() => ({ current: { getBoundingClientRect: () => anchor ?? new DOMRect() } }), [anchor])

  useEffect(() => {
    let selecting = false
    let keyboardSelectionKeys: Set<string> | null = null
    let canShow = false
    let frame = 0
    const dismiss = () => setAnchor(null)
    const showSelection = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !selection.rangeCount || !selection.toString()) {
        dismiss()
        return
      }
      const range = selection.getRangeAt(0)
      const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
      const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
      if (
        start?.closest(SCOPE_SELECTOR) !== scopeRef.current ||
        end?.closest(SCOPE_SELECTOR) !== scopeRef.current ||
        start?.closest(EDITABLE_SELECTOR) ||
        end?.closest(EDITABLE_SELECTOR)
      ) {
        dismiss()
        return
      }
      const rect = range.getBoundingClientRect()
      setAnchor(rect.width || rect.height ? rect : null)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && toolbarRef.current?.contains(event.target)) return
      keyboardSelectionKeys = null
      selecting = event.button === 0 && event.target instanceof Node && !!scopeRef.current?.contains(event.target)
      canShow = selecting
      cancelAnimationFrame(frame)
      dismiss()
    }
    const onPointerUp = (event: PointerEvent) => {
      if (!selecting || event.button !== 0) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        selecting = false
        showSelection()
      })
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        keyboardSelectionKeys = null
        canShow = false
        cancelAnimationFrame(frame)
        dismiss()
      } else if (
        (event.shiftKey &&
          (event.key.startsWith('Arrow') || ['Home', 'End', 'PageUp', 'PageDown'].includes(event.key))) ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')
      ) {
        cancelAnimationFrame(frame)
        keyboardSelectionKeys ??= new Set()
        keyboardSelectionKeys.add(event.key.toLowerCase())
        canShow = true
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (!keyboardSelectionKeys) return
      if (event.key === 'Shift') keyboardSelectionKeys.clear()
      else if (!keyboardSelectionKeys.delete(event.key.toLowerCase())) return
      if (keyboardSelectionKeys.size > 0) return
      cancelAnimationFrame(frame)
      // Preserve the finishing gesture through selection-driven scroll events in this frame.
      frame = requestAnimationFrame(() => {
        keyboardSelectionKeys = null
        showSelection()
      })
    }
    const onSelectionChange = () => {
      if (canShow && !selecting && !keyboardSelectionKeys) showSelection()
      else dismiss()
    }
    const onBlur = () => {
      selecting = false
      keyboardSelectionKeys = null
      canShow = false
      cancelAnimationFrame(frame)
      dismiss()
    }
    const onScroll = () => {
      if (!selecting && !keyboardSelectionKeys) {
        canShow = false
        cancelAnimationFrame(frame)
      }
      dismiss()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onBlur)
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('contextmenu', onBlur)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onBlur)
    window.addEventListener('blur', onBlur)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onBlur)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('contextmenu', onBlur)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onBlur)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const runAction = (action: (selection: Selection) => void) => {
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) action(selection)
    setAnchor(null)
  }

  return (
    <div ref={scopeRef} className="contents" data-selection-actions-scope>
      {children}
      <Popover open={anchor !== null} onOpenChange={(open) => !open && setAnchor(null)}>
        <PopoverAnchor virtualRef={virtualRef} />
        {anchor && (
          <PopoverContent
            ref={toolbarRef}
            side="top"
            sideOffset={8}
            collisionPadding={8}
            className="flex w-auto gap-0.5 p-1"
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onFocusOutside={(event) => event.preventDefault()}
            onPointerDown={(event) => event.preventDefault()}>
            <Button type="button" variant="ghost" size="sm" onClick={() => runAction(onCopy)}>
              <Copy aria-hidden="true" />
              {t('common.copy')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => runAction(onQuote)}>
              <Quote aria-hidden="true" />
              {t('chat.message.quote')}
            </Button>
          </PopoverContent>
        )}
      </Popover>
    </div>
  )
}
