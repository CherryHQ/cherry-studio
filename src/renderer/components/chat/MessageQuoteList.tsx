import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import type { MessageQuote } from '@shared/data/types/message'

const Markdown = lazy(() =>
  import('@renderer/components/markdown').then((module) => ({ default: module.StaticMarkdown }))
)

interface Props {
  quotes: readonly MessageQuote[]
  onRemove?: (id: string) => void
  onClear?: () => void
  onLocate?: (messageId: string) => void
}

export function MessageQuoteList({ quotes, onRemove, onClear, onLocate }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [expandedList, setExpandedList] = useState<string | null>(null)
  const listKey = JSON.stringify(quotes.map((quote) => quote.id))
  const isListExpanded = quotes.length === 1 || expandedList === listKey
  if (!quotes.length) return null

  return (
    <div className={`${isListExpanded ? 'my-2' : 'mt-1 mb-3'} ml-3 ${onRemove || onClear ? 'mr-10' : 'mr-3'}`}>
      {quotes.length > 1 ? (
        <div className="group/quotes flex w-fit items-center rounded-md pr-1 hover:bg-accent has-[:focus-visible]:bg-accent">
          <Button
            variant="ghost"
            size="sm"
            className="justify-start pr-0 hover:bg-transparent focus-visible:bg-transparent"
            aria-expanded={isListExpanded}
            onClick={() => setExpandedList(isListExpanded ? null : listKey)}>
            {t('chat.message.quotes.title')} ({quotes.length})
            {isListExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </Button>
          {onClear ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="group/clear opacity-0 transition-opacity duration-150 hover:bg-transparent focus-visible:bg-transparent group-hover/quotes:opacity-100 focus-visible:opacity-100 no-hover:opacity-100"
              aria-label={t('chat.message.quotes.clear_all')}
              title={t('chat.message.quotes.clear_all')}
              onClick={() => onClear()}>
              <span className="flex size-5 items-center justify-center rounded-full border border-transparent transition-colors duration-150 group-hover/clear:border-border group-hover/clear:bg-accent group-focus-visible/clear:border-border group-focus-visible/clear:bg-accent">
                <X className="size-3" />
              </span>
            </Button>
          ) : null}
        </div>
      ) : null}
      {isListExpanded ? (
        <div className="max-h-48 space-y-1 overflow-y-auto" role="list" aria-label={t('chat.message.quotes.title')}>
          {quotes.map((quote, index) => {
            const isExpanded = expanded.has(quote.id)
            return (
              <div
                key={quote.id}
                role="listitem"
                className="rounded-md border-l-2 border-border bg-muted px-2 py-1 text-sm">
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!onLocate}
                    onClick={() => onLocate?.(quote.sourceMessageId)}>
                    {t('chat.message.quotes.reference', { index: index + 1 })}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto"
                    aria-expanded={isExpanded}
                    aria-label={t('chat.message.quotes.expand')}
                    onClick={() =>
                      setExpanded((previous) => {
                        const next = new Set(previous)
                        if (next.has(quote.id)) next.delete(quote.id)
                        else next.add(quote.id)
                        return next
                      })
                    }>
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </Button>
                  {onRemove ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('chat.message.quotes.remove')}
                      onClick={() => onRemove(quote.id)}>
                      <X size={14} />
                    </Button>
                  ) : null}
                </div>
                {isExpanded ? (
                  <div className="max-h-64 overflow-auto">
                    <Suspense fallback={<div className="whitespace-pre-wrap">{quote.text}</div>}>
                      <Markdown>{quote.text}</Markdown>
                    </Suspense>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start px-2 py-1 text-left text-muted-foreground"
                    disabled={!onLocate}
                    onClick={() => onLocate?.(quote.sourceMessageId)}>
                    <span className="line-clamp-2 whitespace-pre-wrap break-words">{quote.text}</span>
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
