import { Copy, Languages, NotebookPen, Quote, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Popover, PopoverAnchor, PopoverContent } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useTranslate, useTranslateLanguages } from '@renderer/hooks/translate'
import { UNKNOWN_LANG_CODE } from '@renderer/utils/translate'

interface TextSelectionToolbarProps {
  children: ReactNode
  getSelectedText: (selection: Selection) => string
  onCopyText: (text: string) => void
  onCopy: (selection: Selection) => void
  onQuote: (selection: Selection) => void
  onSaveToNotes: (selection: Selection) => void
  isSavingNote: boolean
}

const SCOPE_SELECTOR = '[data-selection-actions-scope]'
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'

const TRANSLATE_ERROR_KEYS = [
  'translate.error.not_configured',
  'translate.error.empty',
  'translate.error.failed',
  'translate.error.languages_load_failed'
]

function getTranslateErrorKey(error: unknown, t: (key: string) => string): string {
  const message = error instanceof Error ? error.message : ''
  const key = message.match(/\btranslate\.error\.[a-zA-Z0-9_.-]+\b/)?.[0]
  return (
    (key && TRANSLATE_ERROR_KEYS.includes(key) ? key : TRANSLATE_ERROR_KEYS.find((key) => message === t(key))) ??
    'translate.error.failed'
  )
}

interface SelectionSnapshot {
  startContainer: Node
  startOffset: number
  endContainer: Node
  endOffset: number
  text: string
}

interface TranslationState {
  status: 'idle' | 'loading' | 'done' | 'error'
  text: string
  targetLabel: string
  errorKey: string
}

const IDLE_TRANSLATION: TranslationState = { status: 'idle', text: '', targetLabel: '', errorKey: '' }

export function TextSelectionToolbar({
  children,
  getSelectedText,
  onCopyText,
  onCopy,
  onQuote,
  onSaveToNotes,
  isSavingNote
}: TextSelectionToolbarProps) {
  const { t } = useTranslation()
  const [translateEnabled] = usePreference('feature.translate.selection_toolbar.enabled')
  const [targetLanguage] = usePreference('feature.translate.page.target_language')
  const { getLabel } = useTranslateLanguages()
  const [translation, setTranslation] = useState<TranslationState>(IDLE_TRANSLATION)
  const requestGenerationRef = useRef(0)
  const selectionSnapshotRef = useRef<SelectionSnapshot | null>(null)
  const { translate, cancel } = useTranslate({
    showErrorToast: false,
    rethrowError: true,
    onResponse: (text) => setTranslation((current) => (current.status === 'loading' ? { ...current, text } : current))
  })
  const scopeRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const virtualRef = useMemo(() => ({ current: { getBoundingClientRect: () => anchor ?? new DOMRect() } }), [anchor])

  const resetTranslation = useCallback(() => {
    requestGenerationRef.current += 1
    cancel()
    selectionSnapshotRef.current = null
    setTranslation(IDLE_TRANSLATION)
  }, [cancel])

  const closeToolbar = useCallback(() => {
    resetTranslation()
    setAnchor(null)
  }, [resetTranslation])

  const getSelectedTextRef = useRef(getSelectedText)
  useEffect(() => {
    getSelectedTextRef.current = getSelectedText
  }, [getSelectedText])

  const getSelectionSnapshot = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount || !selection.toString()) return null
    const range = selection.getRangeAt(0)
    const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
    const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
    if (
      start?.closest(SCOPE_SELECTOR) !== scopeRef.current ||
      end?.closest(SCOPE_SELECTOR) !== scopeRef.current ||
      start?.closest(EDITABLE_SELECTOR) ||
      end?.closest(EDITABLE_SELECTOR)
    )
      return null
    const rect = range.getBoundingClientRect()
    if (!rect.width && !rect.height) return null
    return {
      rect,
      snapshot: {
        startContainer: range.startContainer,
        startOffset: range.startOffset,
        endContainer: range.endContainer,
        endOffset: range.endOffset,
        text: getSelectedTextRef.current(selection)
      }
    }
  }, [])

  useEffect(() => {
    if (!translateEnabled) resetTranslation()
  }, [translateEnabled, resetTranslation])

  useEffect(
    () => () => {
      requestGenerationRef.current += 1
      cancel()
    },
    [cancel]
  )

  useEffect(() => {
    let selecting = false
    let keyboardSelectionKeys: Set<string> | null = null
    let canShow = false
    let frame = 0
    const showSelection = () => {
      const selected = getSelectionSnapshot()
      if (!selected) {
        closeToolbar()
        return
      }
      const previous = selectionSnapshotRef.current
      const next = selected.snapshot
      if (
        previous &&
        (previous.startContainer !== next.startContainer ||
          previous.startOffset !== next.startOffset ||
          previous.endContainer !== next.endContainer ||
          previous.endOffset !== next.endOffset ||
          previous.text !== next.text)
      )
        resetTranslation()
      setAnchor(selected.rect)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && toolbarRef.current?.contains(event.target)) return
      keyboardSelectionKeys = null
      selecting = event.button === 0 && event.target instanceof Node && !!scopeRef.current?.contains(event.target)
      canShow = selecting
      cancelAnimationFrame(frame)
      closeToolbar()
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
        closeToolbar()
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
      else closeToolbar()
    }
    const onBlur = () => {
      selecting = false
      keyboardSelectionKeys = null
      canShow = false
      cancelAnimationFrame(frame)
      closeToolbar()
    }
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && toolbarRef.current?.contains(event.target)) return
      if (!selecting && !keyboardSelectionKeys) {
        canShow = false
        cancelAnimationFrame(frame)
      }
      closeToolbar()
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
  }, [closeToolbar, getSelectionSnapshot, resetTranslation])

  const runAction = (action: (selection: Selection) => void) => {
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) action(selection)
    closeToolbar()
  }

  const handleTranslate = async () => {
    const selected = getSelectionSnapshot()
    if (!selected) {
      closeToolbar()
      return
    }
    if (!selected.snapshot.text.trim()) return
    resetTranslation()
    const generation = requestGenerationRef.current
    const target = targetLanguage === UNKNOWN_LANG_CODE ? 'en-us' : targetLanguage
    selectionSnapshotRef.current = selected.snapshot
    setTranslation({ status: 'loading', text: '', targetLabel: getLabel(target, false) ?? target, errorKey: '' })
    try {
      const result = await translate(selected.snapshot.text, target)
      if (requestGenerationRef.current !== generation || result === undefined) return
      if (!result.trim()) throw new Error('translate.error.empty')
      setTranslation((current) => ({ ...current, status: 'done', text: result }))
    } catch (error) {
      if (requestGenerationRef.current !== generation) return
      setTranslation((current) => ({ ...current, status: 'error', errorKey: getTranslateErrorKey(error, t) }))
    }
  }

  return (
    <div ref={scopeRef} className="contents" data-selection-actions-scope>
      {children}
      <Popover open={anchor !== null} onOpenChange={(open) => !open && closeToolbar()}>
        <PopoverAnchor virtualRef={virtualRef} />
        {anchor && (
          <PopoverContent
            ref={toolbarRef}
            side="top"
            sideOffset={8}
            collisionPadding={8}
            className={
              translation.status === 'idle'
                ? 'flex w-auto gap-0.5 p-1'
                : 'flex w-80 max-w-[min(20rem,90vw)] flex-col gap-2 p-3'
            }
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onFocusOutside={(event) => event.preventDefault()}
            onPointerDown={(event) => event.preventDefault()}>
            {translation.status === 'idle' ? (
              <>
                <Button type="button" variant="ghost" size="sm" onClick={() => runAction(onCopy)}>
                  <Copy aria-hidden="true" />
                  {t('common.copy')}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => runAction(onQuote)}>
                  <Quote aria-hidden="true" />
                  {t('chat.message.quote')}
                </Button>
                {translateEnabled && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => void handleTranslate()}>
                    <Languages aria-hidden="true" />
                    {t('translate.button.translate')}
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
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {t('translate.translate_to')} {translation.targetLabel}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('common.close')}
                    onClick={closeToolbar}>
                    <X aria-hidden="true" />
                  </Button>
                </div>
                <div className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-sm">
                  {translation.status === 'error'
                    ? t(translation.errorKey)
                    : translation.text || t('translate.processing')}
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={translation.status !== 'done'}
                    onClick={() => onCopyText(translation.text)}>
                    <Copy aria-hidden="true" />
                    {t('common.copy')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={resetTranslation}>
                    {t('common.back')}
                  </Button>
                </div>
              </>
            )}
          </PopoverContent>
        )}
      </Popover>
    </div>
  )
}
