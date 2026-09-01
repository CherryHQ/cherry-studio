import { defaultMarkdownPlugins, Scrollbar, StreamingMarkdown, withMath } from '@cherrystudio/ui'
import { Check, Copy, NotebookPen } from 'lucide-react'
import type { Ref } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

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
  const markdownPlugins = useMemo(() => ({ ...defaultMarkdownPlugins, math: withMath({ singleDollar: true }) }), [])

  return (
    <div
      data-ui="translate.output"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
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
        <IconButton
          size="sm"
          onClick={onExportToNotes}
          disabled={!translatedContent.trim()}
          aria-label={t('notes.save')}
          className="ml-auto">
          <NotebookPen size={14} />
        </IconButton>
      </div>
    </div>
  )
}

export default TranslateOutputPane
