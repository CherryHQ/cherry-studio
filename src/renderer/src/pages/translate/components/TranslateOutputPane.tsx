import { cn } from '@renderer/utils'
import { Check, CirclePause, Copy, Languages } from 'lucide-react'
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
  couldTranslate: boolean
  onCopy: () => void
  onTranslate: () => void
  onAbort: () => void
  onScroll: (event: UIEvent<HTMLDivElement>) => void
}

const TranslateOutputPane = ({
  ref,
  translatedContent,
  renderedMarkdown,
  enableMarkdown,
  translating,
  copied,
  couldTranslate,
  onCopy,
  onTranslate,
  onAbort,
  onScroll
}: Props) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-br-xs bg-muted/40">
      <div
        ref={ref}
        onScroll={onScroll}
        className="selectable min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[13px] leading-relaxed">
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
        ) : (
          <span className="select-none text-foreground-muted">{t('translate.output.placeholder')}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-0.5">
          <IconButton size="md" onClick={onCopy} disabled={!translatedContent} aria-label={t('common.copy')}>
            {copied ? <Check size={12} className="text-foreground" /> : <Copy size={12} />}
          </IconButton>
        </div>
        <div className="flex items-center gap-2">
          {translatedContent && <span className="text-[10px] text-foreground-muted">{translatedContent.length}</span>}
          {translating ? (
            <button
              type="button"
              onClick={onAbort}
              className="flex items-center gap-1.5 rounded-2xs bg-secondary px-3 py-1 text-foreground text-xs transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
              <CirclePause size={12} className="lucide-custom" />
              <span>{t('common.stop')}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onTranslate}
              disabled={!couldTranslate}
              className={cn(
                'flex items-center gap-1.5 rounded-2xs px-3 py-1 text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                couldTranslate
                  ? 'bg-primary text-primary-foreground hover:opacity-90'
                  : 'cursor-not-allowed bg-muted text-foreground-muted'
              )}>
              <Languages size={12} className="lucide-custom" />
              <span>{t('translate.button.translate')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default TranslateOutputPane
