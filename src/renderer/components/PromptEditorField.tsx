import '@cherrystudio/ui/composites/markdown/styles'

import { Button, CodeEditor, type CodeEditorHandles, Field, FieldContent, FieldError } from '@cherrystudio/ui'
import { Markdown } from '@cherrystudio/ui/composites/markdown'
import { usePreference } from '@data/hooks/usePreference'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { Edit, Eye } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { estimateTokenCount as estimateTextTokens } from 'tokenx'

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
  maxHeight = '50vh'
}: PromptEditorFieldProps) {
  const { t } = useTranslation()
  const previewId = useId()
  const [fontSize] = usePreference('chat.message.font_size')
  const { activeCmTheme } = useCodeStyle()
  const [showPreview, setShowPreview] = useState(value.length > 0)
  const previousResetPreviewKey = useRef(resetPreviewKey)
  const codeEditorRef = useRef<CodeEditorHandles | null>(null)
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

  return (
    <Field data-invalid={hasError || undefined} className="gap-1.5">
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
            disabled={value.length === 0}
            className="flex h-auto min-h-0 items-center gap-1 rounded-2xs border border-border/20 px-2 py-[3px] font-normal text-muted-foreground/80 text-xs shadow-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40">
            {effectiveShowPreview ? <Edit size={10} /> : <Eye size={10} />}
            <span>{t(effectiveShowPreview ? 'common.edit' : 'common.preview')}</span>
          </Button>
        </div>
      </div>

      <FieldContent>
        <div
          aria-invalid={hasError || undefined}
          className={`overflow-hidden rounded-md border bg-accent/15 transition-all focus-within:bg-accent/20 ${
            hasError
              ? 'border-destructive/50 focus-within:border-destructive/60'
              : 'border-border/20 focus-within:border-border/40'
          }`}>
          {effectiveShowPreview ? (
            <div
              className="markdown overflow-auto p-3 text-foreground text-xs"
              style={{ minHeight, maxHeight }}
              onDoubleClick={() => setShowPreview(false)}>
              <Markdown id={previewId}>{previewValue || value}</Markdown>
            </div>
          ) : (
            <CodeEditor
              ref={codeEditorRef}
              theme={activeCmTheme}
              fontSize={fontSize - 1}
              value={value}
              language="markdown"
              onChange={handleChange}
              expanded={false}
              minHeight={minHeight}
              maxHeight={maxHeight}
              placeholder={placeholder}
            />
          )}
        </div>
        <FieldError className="text-xs" errors={error ? [{ message: error }] : undefined} />
        <div className="flex justify-between text-muted-foreground/80 text-xs">
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
