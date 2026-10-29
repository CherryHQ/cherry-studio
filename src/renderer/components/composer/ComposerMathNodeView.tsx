import '@renderer/assets/styles/vendor/katex.css'
import { closeHistory } from '@tiptap/pm/history'
import { TextSelection } from '@tiptap/pm/state'
import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import katex from 'katex'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input, Label, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { toast } from '@renderer/services/toast'

import { COMPOSER_INPUT_MAX_LENGTH, serializeComposerDocument } from './composerDraft'
import { serializeComposerMath, transformComposerMathTextRun } from './composerMath'
import { PROMPT_VARIABLE_TOKENIZATION_META } from './promptVariables'

export function ComposerMathNodeView({ node, editor, getPos, extension }: NodeViewProps) {
  const { t } = useTranslation()
  const latex: string = node.attrs.latex
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(latex)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const mathRef = useRef<HTMLSpanElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const canEdit = () => !editor.isDestroyed && editor.isEditable && extension.options.enabled()

  useEffect(() => {
    const element = mathRef.current
    if (!element) return
    try {
      katex.render(latex, element, {
        displayMode: false,
        throwOnError: true,
        trust: false,
        strict: 'error',
        output: 'htmlAndMathml'
      })
    } catch {
      element.replaceChildren(document.createTextNode(serializeComposerMath(latex)))
    }
  }, [latex])

  useEffect(() => {
    const closeIfUnavailable = () => {
      if (editor.isDestroyed || !editor.isEditable || !extension.options.enabled() || getPos() === undefined) {
        setOpen(false)
      }
    }
    const close = () => setOpen(false)
    editor.on('transaction', closeIfUnavailable)
    editor.on('update', closeIfUnavailable)
    editor.on('destroy', close)
    return () => {
      editor.off('transaction', closeIfUnavailable)
      editor.off('update', closeIfUnavailable)
      editor.off('destroy', close)
    }
  }, [editor, extension, getPos])

  const changeOpen = (nextOpen: boolean) => {
    if (nextOpen && !canEdit()) return
    if (nextOpen) setValue(latex)
    setOpen(nextOpen)
  }

  const confirm = () => {
    const position = getPos()
    if (!canEdit() || position === undefined) return
    const source = serializeComposerMath(value)
    const preview = editor.state.tr.replaceWith(position, position + node.nodeSize, editor.schema.text(source))
    if (serializeComposerDocument(preview.doc.toJSON()).text.length > COMPOSER_INPUT_MAX_LENGTH) {
      toast.error(t('chat.input.math.length_exceeded'))
      return
    }
    const segments = transformComposerMathTextRun(source, [{ from: 0, to: source.length }])
    const valid = segments.length === 1 && segments[0].type === 'inlineMath'
    const tr = valid ? editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, latex: value }) : preview
    closeHistory(tr)
      .setMeta('composerMath', 'derived')
      .setMeta(PROMPT_VARIABLE_TOKENIZATION_META, false)
      .setMeta('addToHistory', true)
    setOpen(false)
    editor.view.dispatch(tr)
    editor.view.dispatch(closeHistory(editor.state.tr))
    if (!valid) editor.commands.focus(position + source.length)
  }

  const remove = () => {
    const position = getPos()
    if (!canEdit() || position === undefined) return
    const tr = closeHistory(editor.state.tr).delete(position, position + node.nodeSize)
    tr.setSelection(TextSelection.near(tr.doc.resolve(position)))
    setOpen(false)
    editor.view.dispatch(tr.setMeta('composerMath', 'derived').setMeta('addToHistory', true))
    editor.view.dispatch(closeHistory(editor.state.tr))
    editor.commands.focus()
  }

  return (
    <NodeViewWrapper as="span" contentEditable={false} data-testid="composer-inline-math" data-latex={latex}>
      <Popover open={open} onOpenChange={changeOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="ghost"
            className="h-auto px-1 py-0"
            aria-label={t('chat.input.math.edit')}>
            <span ref={mathRef} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          role="dialog"
          aria-label={t('chat.input.math.edit')}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            inputRef.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            triggerRef.current?.focus()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.stopPropagation()
              if (event.key === 'Escape') {
                event.preventDefault()
                setOpen(false)
              } else if (event.target === inputRef.current) {
                event.preventDefault()
                if (!event.nativeEvent.isComposing) confirm()
              }
            }
          }}>
          <div className="flex flex-col gap-3">
            <Label htmlFor={inputId}>{t('chat.input.math.source')}</Label>
            <Input ref={inputRef} id={inputId} value={value} onChange={(event) => setValue(event.target.value)} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={remove}>
                {t('common.delete')}
              </Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="button" onClick={confirm}>
                {t('common.confirm')}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  )
}
