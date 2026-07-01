import { Check, Copy } from 'lucide-react'
import type { Ref, UIEvent } from 'react'
import { useTranslation } from 'react-i18next'

import IconButton from './IconButton'

type Props = {
  ref?: Ref<HTMLDivElement>
  translatedContent: string
  renderedMarkdown: string
  enableMarkdown: boolean
  translating: boolean
  copied: boolean
  onCopy: () => void
  onScroll: (event: UIEvent<HTMLDivElement>) => void
}

const TranslateOutputPane = ({
  ref,
  translatedContent,
  renderedMarkdown,
  enableMarkdown,
  translating,
  copied,
  onCopy,
  onScroll
}: Props) => {
  const { t } = useTranslation()

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div
        ref={ref}
        onScroll={onScroll}
        className="selectable min-h-0 flex-1 overflow-y-auto p-4 pe-12 text-base leading-relaxed">
        <div className="flex min-h-full flex-col">
          {translating && !translatedContent ? (
            <div className="flex items-center gap-2 text-foreground-secondary">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
              <span>{t('translate.processing')}</span>
            </div>
          ) : translatedContent ? (
            enableMarkdown ? (
              <div className="markdown" dangerouslySetInnerHTML={{ __html: renderedMarkdown }} />
            ) : (
              <div className="wrap-break-word whitespace-pre-wrap text-foreground">{translatedContent}</div>
            )
          ) : null}
        </div>
      </div>
      <IconButton
        size="sm"
        onClick={onCopy}
        disabled={!translatedContent}
        aria-label={t('common.copy')}
        className="absolute end-3 top-4">
        {copied ? <Check size={14} className="text-foreground" /> : <Copy size={14} />}
      </IconButton>
      <div className="flex shrink-0 items-center px-3 py-4">
        {translatedContent && <span className="text-foreground-muted text-xs">{translatedContent.length}</span>}
      </div>
    </div>
  )
}

export default TranslateOutputPane
