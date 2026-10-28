import '@cherrystudio/ui/components/composites/markdown/styles'
import type { EditorState } from '@uiw/react-codemirror'
import { Edit, Eye } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { estimateTokenCount as estimateTextTokens } from 'tokenx'

import { Button, type CodeEditorHandles, Field, FieldContent, FieldError } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { LazyCodeEditor } from '@renderer/components/LazyCodeEditor'
import { StaticMarkdown } from '@renderer/components/markdown'
import { cn } from '@renderer/utils/style'

export interface PromptEditorFieldHandles {
  insertText: (text: string) => boolean
}

interface PromptEditorFieldProps {
  ref?: React.RefObject<PromptEditorFieldHandles | null>
  label: ReactNode
  value: string
  onChange: (value: string) => void
  placeholder?: string
  error?: string
  actions?: ReactNode
  labelAddon?: ReactNode
  previewValue?: string
  resetPreviewKey?: unknown
  minHeight?: string
  maxHeight?: string
  autoFocus?: boolean
  fill?: boolean
  disabled?: boolean
}

export function PromptEditorField({
  ref,
  label,
  value,
  onChange,
  placeholder,
  error,
  actions,
  labelAddon,
  previewValue,
  resetPreviewKey,
  minHeight = '200px',
  maxHeight = '50vh',
  autoFocus = false,
  fill = false,
  disabled = false
}: PromptEditorFieldProps) {
  const { t } = useTranslation()
  const previewId = useId()
  const [fontSize] = usePreference('chat.message.font_size')
  const [showPreview, setShowPreview] = useState(value.length > 0)
  const previousResetPreviewKey = useRef(resetPreviewKey)
  const codeEditorRef = useRef<CodeEditorHandles | null>(null)
  const [session, setSession] = useState(() => ({
    accepted: value,
    stateRef: { current: null as EditorState | null },
    epoch: 0
  }))
  if (session.accepted !== value) {
    const echoed = session.stateRef.current?.sliceDoc() === value
    setSession({
      accepted: value,
      stateRef: echoed ? session.stateRef : { current: null },
      epoch: session.epoch + Number(!echoed)
    })
  }
  const hasError = Boolean(error)
  const effectiveShowPreview = showPreview && value.length > 0
  const tokenCount = useMemo(() => estimateTextTokens(value), [value])

  useImperativeHandle(ref, () => ({
    insertText: (text: string) => codeEditorRef.current?.insertText?.(text) ?? false
  }))

  useEffect(() => {
    if (previousResetPreviewKey.current === resetPreviewKey) return
    previousResetPreviewKey.current = resetPreviewKey
    setShowPreview(false)
  }, [resetPreviewKey])

  const handleChange = (nextValue: string) => {
    onChange(nextValue)
  }

  // CodeMirror only focuses on clicks that land on its content. Clicking the gutter or the
  // empty area below the text leaves the editor unfocused, so forward those clicks manually.
  const handleEditorAreaMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (disabled || effectiveShowPreview) return
    if ((event.target as HTMLElement).closest('.cm-content')) return
    event.preventDefault()
    codeEditorRef.current?.focus?.()
  }

  return (
    <Field
      data-invalid={hasError || undefined}
      className={fill ? 'min-h-0 max-w-full min-w-0 flex-1 gap-1.5' : 'max-w-full min-w-0 gap-1.5'}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {label}
          {labelAddon}
        </div>
        <div className="flex items-center gap-1.5">
          {actions}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowPreview((v) => !v)}
            disabled={disabled || value.length === 0}
            className="flex h-6 min-h-0 items-center gap-1 rounded-md border border-border-subtle px-2 py-0 text-xs font-normal text-muted-foreground! shadow-none transition-colors hover:bg-accent/50 hover:text-foreground! focus-visible:bg-accent/50 focus-visible:text-foreground! focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40">
            {effectiveShowPreview ? <Edit className="size-3" /> : <Eye className="size-3" />}
            <span>{t(effectiveShowPreview ? 'common.edit' : 'common.preview')}</span>
          </Button>
        </div>
      </div>

      <FieldContent className={fill ? 'min-h-0 max-w-full min-w-0' : 'max-w-full min-w-0'}>
        <div
          aria-invalid={hasError || undefined}
          onMouseDown={handleEditorAreaMouseDown}
          className={cn(
            'max-w-full min-w-0 overflow-hidden rounded-md border bg-background transition-all',
            fill && 'flex min-h-0 flex-1 flex-col',
            hasError ? 'border-error-border focus-within:border-error' : 'border-border focus-within:border-ring',
            disabled && 'cursor-not-allowed opacity-50'
          )}>
          {effectiveShowPreview ? (
            <div
              className={cn(
                'prompt-preview markdown max-w-full min-w-0 overflow-auto p-3 text-xs text-foreground',
                fill && 'min-h-0 flex-1'
              )}
              style={fill ? undefined : { minHeight, maxHeight }}
              onDoubleClick={() => !disabled && setShowPreview(false)}>
              <StaticMarkdown id={previewId}>{previewValue || value}</StaticMarkdown>
            </div>
          ) : (
            <LazyCodeEditor
              key={session.epoch}
              ref={codeEditorRef}
              stateRef={session.stateRef}
              fontSize={fontSize - 1}
              value={value}
              autoFocus={autoFocus}
              language="markdown"
              onChange={handleChange}
              editable={!disabled}
              options={{ foldGutter: false, lineNumbers: false }}
              expanded={false}
              className={fill ? 'min-h-0 flex-1' : undefined}
              height={fill ? '100%' : undefined}
              minHeight={fill ? undefined : minHeight}
              maxHeight={fill ? undefined : maxHeight}
              placeholder={placeholder}
            />
          )}
        </div>
        <FieldError className="text-xs" errors={error ? [{ message: error }] : undefined} />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{t('library.config.prompt.dblclick_hint')}</span>
          <span className="tabular-nums">
            {t('library.config.prompt.tokens_label')}
            {tokenCount}
          </span>
        </div>
      </FieldContent>
    </Field>
  )
}

export default PromptEditorField
