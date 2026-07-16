import '@cherrystudio/ui/components/composites/markdown/styles'

import { Button, CodeEditor, type CodeEditorHandles, Field, FieldContent, FieldError, Markdown } from '@cherrystudio/ui'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { usePreference } from '@data/hooks/usePreference'
import { tags } from '@lezer/highlight'
import { useTheme } from '@renderer/hooks/useTheme'
import { cn } from '@renderer/utils/style'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { Edit, Eye } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { estimateTokenCount as estimateTextTokens } from 'tokenx'

const promptEditorThemeSpec = {
  '&': {
    backgroundColor: 'var(--color-background)',
    color: 'var(--color-foreground)'
  },
  '.cm-scroller': {
    backgroundColor: 'var(--color-background)'
  },
  '.cm-content': {
    caretColor: 'var(--color-foreground)',
    padding: 'var(--cs-size-3xs)'
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--color-foreground)'
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent'
  },
  '.cm-placeholder': {
    color: 'var(--color-foreground-muted)'
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--color-accent) !important'
  }
}

const promptEditorHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.content, color: 'var(--color-foreground)' },
    {
      tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6],
      color: 'var(--color-foreground)',
      fontWeight: 'var(--font-weight-medium)'
    },
    { tag: tags.strong, color: 'var(--color-foreground)', fontWeight: 'var(--font-weight-bold)' },
    { tag: tags.emphasis, color: 'var(--color-foreground)', fontStyle: 'italic' },
    {
      tag: [tags.link, tags.url],
      color: 'var(--color-primary)',
      textDecoration: 'underline'
    },
    { tag: [tags.monospace, tags.quote], color: 'var(--color-foreground)' },
    { tag: tags.comment, color: 'var(--color-foreground-secondary)', fontStyle: 'italic' },
    {
      tag: [tags.processingInstruction, tags.contentSeparator],
      color: 'var(--color-foreground-secondary)'
    }
  ])
)

const promptEditorThemes = {
  light: [EditorView.theme(promptEditorThemeSpec), promptEditorHighlighting],
  dark: [EditorView.theme(promptEditorThemeSpec, { dark: true }), promptEditorHighlighting]
}

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
  fill = false
}: PromptEditorFieldProps) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const previewId = useId()
  const [fontSize] = usePreference('chat.message.font_size')
  const [showPreview, setShowPreview] = useState(value.length > 0)
  const previousResetPreviewKey = useRef(resetPreviewKey)
  const codeEditorRef = useRef<CodeEditorHandles | null>(null)
  const hasError = Boolean(error)
  const effectiveShowPreview = showPreview && value.length > 0
  const promptEditorTheme = theme === ThemeMode.dark ? promptEditorThemes.dark : promptEditorThemes.light
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
    if (effectiveShowPreview) return
    if ((event.target as HTMLElement).closest('.cm-content')) return
    event.preventDefault()
    codeEditorRef.current?.focus?.()
  }

  return (
    <Field data-invalid={hasError || undefined} className={fill ? 'min-h-0 flex-1 gap-1.5' : 'gap-1.5'}>
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
            className="flex h-auto min-h-0 items-center gap-1 rounded-full border border-border px-2 py-[3px] font-normal text-muted-foreground text-xs shadow-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40">
            {effectiveShowPreview ? <Edit size={10} /> : <Eye size={10} />}
            <span>{t(effectiveShowPreview ? 'common.edit' : 'common.preview')}</span>
          </Button>
        </div>
      </div>

      <FieldContent className={fill ? 'min-h-0' : undefined}>
        <div
          aria-invalid={hasError || undefined}
          onMouseDown={handleEditorAreaMouseDown}
          className={cn(
            'overflow-hidden rounded-md border bg-background transition-all focus-within:ring-2 focus-within:ring-ring/50',
            fill && 'flex min-h-0 flex-1 flex-col',
            hasError
              ? 'border-destructive/50 focus-within:border-destructive/60'
              : 'border-border focus-within:border-border-hover'
          )}>
          {effectiveShowPreview ? (
            <div
              className={cn('markdown overflow-auto p-3 text-foreground text-xs', fill && 'min-h-0 flex-1')}
              style={fill ? undefined : { minHeight, maxHeight }}
              onDoubleClick={() => setShowPreview(false)}>
              <Markdown id={previewId}>{previewValue || value}</Markdown>
            </div>
          ) : (
            <CodeEditor
              ref={codeEditorRef}
              theme={promptEditorTheme}
              fontSize={fontSize - 1}
              value={value}
              autoFocus={autoFocus}
              language="markdown"
              onChange={handleChange}
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
