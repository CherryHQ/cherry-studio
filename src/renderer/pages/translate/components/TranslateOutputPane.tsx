import { Check, Copy, NotebookPen, Volume2 } from 'lucide-react'
import type { Ref } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, defaultMarkdownPlugins, Scrollbar, StreamingMarkdown, withMath } from '@cherrystudio/ui'
import { readTextAloud } from '@renderer/services/voice'

import IconButton from './IconButton'

type Props = {
  ref?: Ref<HTMLDivElement>
  translatedContent: string
  enableMarkdown: boolean
  translating: boolean
  copied: boolean
  onCopy: () => void
  onExportToNotes: () => void
  onScroll: () => void
}

const TranslateOutputPane = ({
  ref,
  translatedContent,
  enableMarkdown,
  translating,
  copied,
  onCopy,
  onExportToNotes,
  onScroll
}: Props) => {
  const { t } = useTranslation()
  const readButtonRef = useRef<HTMLButtonElement>(null)
  const currentResultRef = useRef({ translatedContent, translating })
  currentResultRef.current = { translatedContent, translating }
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const markdownPlugins = useMemo(() => ({ ...defaultMarkdownPlugins, math: withMath({ singleDollar: true }) }), [])

  return (
    <div data-ui="translate.output" className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <Scrollbar
        ref={ref}
        onScroll={onScroll}
        className="selectable min-h-0 flex-1 overflow-x-hidden p-4 pr-12 text-base leading-relaxed">
        <div className="flex min-h-full flex-col">
          {translating && !translatedContent ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
              <span>{t('translate.processing')}</span>
            </div>
          ) : translatedContent ? (
            enableMarkdown ? (
              // The shared streaming component memoizes completed blocks, so
              // long documents render live without a per-frame full reparse.
              <StreamingMarkdown
                id="translate-output"
                plugins={markdownPlugins}
                animated={translating ? undefined : false}
                parseIncompleteMarkdown={translating}>
                {translatedContent}
              </StreamingMarkdown>
            ) : (
              <div className="wrap-break-word whitespace-pre-wrap text-foreground">{translatedContent}</div>
            )
          ) : null}
        </div>
      </Scrollbar>
      <div className="absolute top-4 right-3 flex">
        <IconButton size="sm" onClick={onCopy} disabled={!translatedContent} aria-label={t('common.copy')}>
          {copied ? <Check size={14} className="text-foreground" /> : <Copy size={14} />}
        </IconButton>
      </div>
      <div className="flex shrink-0 items-center px-3 py-4">
        {translatedContent && <span className="text-foreground-tertiary text-xs">{translatedContent.length}</span>}
        <Button
          ref={readButtonRef}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('chat.message.read_aloud.label')}
          disabled={translating || !translatedContent.trim()}
          className="ml-auto"
          onClick={() =>
            void readTextAloud({
              text: translatedContent,
              mode: 'document',
              sourceLabel: 'document',
              sourceEntityId: 'translate-page-result',
              isCurrent: () =>
                mountedRef.current &&
                !currentResultRef.current.translating &&
                currentResultRef.current.translatedContent === translatedContent,
              focusOnClose: () => readButtonRef.current?.focus()
            })
          }>
          <Volume2 className="size-4" />
        </Button>
        <IconButton
          size="sm"
          onClick={onExportToNotes}
          disabled={!translatedContent.trim()}
          aria-label={t('notes.save')}
          className="ml-1">
          <NotebookPen size={14} />
        </IconButton>
      </div>
    </div>
  )
}

export default TranslateOutputPane
