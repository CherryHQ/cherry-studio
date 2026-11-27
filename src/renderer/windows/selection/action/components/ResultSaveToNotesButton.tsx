import { NotebookPen } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'

const logger = loggerService.withContext('ResultSaveToNotesButton')

const MARKDOWN_FENCE_LINE = /^(?:`{3,}[^`]*|~{3,}.*)$/
const MAX_NOTE_TITLE_LENGTH = 50

function extractFirstTitleLine(text?: string): string | undefined {
  return text
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !MARKDOWN_FENCE_LINE.test(line))
}

/**
 * Build the title and Markdown body for a Selection Assistant note containing
 * both the original selected text (as a blockquote when present) and the result.
 */
export function buildSelectionNotePayload(
  selectedText: string | undefined,
  resultText: string,
  untitledFallback: string
): { title: string; content: string } {
  const trimmedSelected = selectedText?.trim() ?? ''
  const trimmedResult = resultText.trim()

  const titleSource = extractFirstTitleLine(trimmedSelected) ?? extractFirstTitleLine(trimmedResult)
  const title = titleSource?.slice(0, MAX_NOTE_TITLE_LENGTH) || untitledFallback

  if (!trimmedSelected) {
    return { title, content: trimmedResult }
  }

  const quotedOriginal = trimmedSelected
    .split(/\r?\n/)
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')

  return {
    title,
    content: `${quotedOriginal}\n\n${trimmedResult}`
  }
}

export function ResultSaveToNotesButton({ selectedText, resultText }: { selectedText?: string; resultText: string }) {
  const { t } = useTranslation()
  const [notesPath] = usePreference('feature.notes.path')
  const [isSaving, setIsSaving] = useState(false)
  const savingRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const isDisabled = isSaving || !resultText.trim()

  const handleSaveToNotes = async () => {
    if (!resultText.trim() || savingRef.current) return
    savingRef.current = true
    setIsSaving(true)
    try {
      const { exportContentToNotes } = await import('@renderer/services/ExportService')
      const { title, content } = buildSelectionNotePayload(selectedText, resultText, t('notes.untitled_note'))
      await exportContentToNotes(title, content, notesPath)
    } catch (error) {
      // exportContentToNotes owns the user-facing error toast.
      logger.error('Failed to save selection result to Notes', error as Error)
    } finally {
      savingRef.current = false
      if (mountedRef.current) {
        setIsSaving(false)
      }
    }
  }

  return (
    <Tooltip content={t('notes.save')} placement="top" asChild>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isDisabled}
        loading={isSaving}
        loadingIconClassName="size-3.5"
        className="h-[22px] min-h-0 min-w-0 shrink gap-1.5 rounded bg-muted px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={t('notes.save')}
        onClick={() => void handleSaveToNotes()}>
        {!isSaving && <NotebookPen className="size-3.5" aria-hidden="true" />}
        <span className="truncate">{t('notes.save')}</span>
      </Button>
    </Tooltip>
  )
}
