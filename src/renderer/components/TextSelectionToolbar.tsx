import { Copy, NotebookPen, Quote, Reply } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Popover, PopoverAnchor, PopoverContent, Textarea } from '@cherrystudio/ui'
import { CommandShortcut } from '@renderer/components/command'
import type { createQuoteToken } from '@renderer/components/composer/variants/shared/composerQuote'
import { useCommandHandler } from '@renderer/hooks/command'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'

interface TextSelectionToolbarProps {
  children: ReactNode
  onCopy: (selection: Selection) => void
  onQuote: (selection: Selection) => void
  onSaveToNotes: (selection: Selection) => void
  onStartReply: (selection: Selection) => ReturnType<typeof createQuoteToken> | null
  onSaveReply?: (text: string, quote: ReturnType<typeof createQuoteToken>) => boolean
  isSavingNote: boolean
}

const SCOPE_SELECTOR = '[data-selection-actions-scope]'
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'

function getScopedSelection(scope: HTMLDivElement | null) {
  const selection = window.getSelection()
  if (!scope || !selection || selection.isCollapsed || !selection.rangeCount || !selection.toString()) return null

  const range = selection.getRangeAt(0)
  const isInScope = (node: Node) => {
    const element = node instanceof Element ? node : node.parentElement
    return element?.closest(SCOPE_SELECTOR) === scope && !element.closest(EDITABLE_SELECTOR)
  }
  return isInScope(range.startContainer) && isInScope(range.endContainer) ? selection : null
}

export function TextSelectionToolbar({
  children,
  onCopy,
  onQuote,
  onSaveToNotes,
  onStartReply,
  onSaveReply,
  isSavingNote
}: TextSelectionToolbarProps) {
  const { t } = useTranslation()
  const scopeRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const [reply, setReply] = useState<{
    quote: NonNullable<ReturnType<TextSelectionToolbarProps['onStartReply']>>
    range: Range
    text: string
  } | null>(null)
  const replyRange = reply?.range
  const isOpen = !!(replyRange || anchor)
  const virtualRef = useMemo(
    () => ({ current: replyRange ?? { getBoundingClientRect: () => anchor ?? new DOMRect() } }),
    [anchor, replyRange]
  )

  useEffect(() => {
    let selecting = false
    let keyboardSelectionKeys: Set<string> | null = null
    let canShow = false
    let frame = 0
    const dismiss = () => setAnchor(null)
    const showSelection = () => {
      const selection = getScopedSelection(scopeRef.current)
      if (!selection) {
        dismiss()
        return
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect()
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
        selecting = false
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
    const selection = getScopedSelection(scopeRef.current)
    if (selection) action(selection)
    setAnchor(null)
  }

  useCommandHandler('chat.message.quote_selection', () => runAction(onQuote), {
    enabled: () => Boolean(anchor && !reply && getScopedSelection(scopeRef.current)),
    shouldHandleKeyEvent: (event) => !event.defaultPrevented && !event.repeat
  })

  const focusReply = useCallback((element: HTMLTextAreaElement | null) => {
    element?.focus({ preventScroll: true })
  }, [])

  const close = () => {
    setAnchor(null)
    setReply(null)
  }

  const saveReply = () => {
    if (reply?.text.trim() && onSaveReply?.(reply.text, reply.quote)) close()
  }

  return (
    <div ref={scopeRef} className="contents" data-selection-actions-scope>
      {children}
      <Popover open={isOpen} onOpenChange={(open) => !open && close()}>
        <PopoverAnchor virtualRef={virtualRef} />
        {isOpen && (
          <PopoverContent
            ref={toolbarRef}
            side="top"
            sideOffset={8}
            collisionPadding={8}
            aria-label={reply ? t('chat.message.reply') : undefined}
            className={reply ? 'w-80 max-w-[calc(100vw-1rem)] p-3' : 'flex w-auto gap-0.5 p-1'}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onFocusOutside={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              if (!reply) event.preventDefault()
            }}>
            {reply ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  saveReply()
                }}>
                <blockquote className="rounded-e-md border-primary border-s-2 bg-muted text-muted-foreground text-sm">
                  {reply.quote.sourceMessageId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={t('chat.input.locate_editing_message')}
                      className="block h-auto w-full rounded-s-none px-3 py-2 text-start whitespace-normal"
                      onClick={() =>
                        void EventEmitter.emit(EVENT_NAMES.LOCATE_QUOTED_MESSAGE, reply.quote.sourceMessageId)
                      }>
                      <span className="line-clamp-3 whitespace-pre-wrap break-words">{reply.quote.description}</span>
                    </Button>
                  ) : (
                    <div className="line-clamp-3 whitespace-pre-wrap break-words px-3 py-2">
                      {reply.quote.description}
                    </div>
                  )}
                </blockquote>
                <Textarea.Input
                  ref={focusReply}
                  aria-label={t('chat.message.reply')}
                  placeholder={t('chat.message.reply')}
                  value={reply.text}
                  onChange={(event) => setReply({ ...reply, text: event.target.value })}
                />
                <div className="flex justify-end gap-1">
                  <Button type="button" variant="ghost" size="sm" onClick={close}>
                    {t('common.cancel')}
                  </Button>
                  <Button type="submit" size="sm" disabled={!onSaveReply || !reply.text.trim()}>
                    {t('common.save')}
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <Button type="button" variant="ghost" size="sm" onClick={() => runAction(onCopy)}>
                  <Copy aria-hidden="true" />
                  {t('common.copy')}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => runAction(onQuote)}>
                  <Quote aria-hidden="true" />
                  {t('chat.message.quote')}
                  <CommandShortcut command="chat.message.quote_selection" />
                </Button>
                {onSaveReply && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      runAction((selection) => {
                        const range = selection.getRangeAt(0).cloneRange()
                        const quote = onStartReply(selection)
                        if (quote) setReply({ quote, range, text: '' })
                      })
                    }>
                    <Reply aria-hidden="true" />
                    {t('chat.message.reply')}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isSavingNote}
                  onClick={() => runAction(onSaveToNotes)}>
                  <NotebookPen aria-hidden="true" />
                  {t('notes.save')}
                </Button>
              </>
            )}
          </PopoverContent>
        )}
      </Popover>
    </div>
  )
}
