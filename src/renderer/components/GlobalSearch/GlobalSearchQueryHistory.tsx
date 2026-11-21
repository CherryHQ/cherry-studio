import { Clock3, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import type { GlobalSearchQueryEntry } from '@shared/data/cache/cacheValueTypes'

import { GLOBAL_SEARCH_QUERY_DISPLAY_LIMIT } from './globalSearchQueryHistory'
import { getGlobalSearchOptionDomId } from './useGlobalSearchKeyboard'

export function GlobalSearchQueryHistory({
  entries,
  onRecall,
  onRemove,
  onClear,
  onFocusInput
}: {
  entries: readonly GlobalSearchQueryEntry[]
  onRecall: (query: string) => void
  onRemove: (query: string) => void
  onClear: () => void
  onFocusInput: () => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const recallRefs = useRef(new Map<string, HTMLButtonElement>())
  if (!entries.length) return null
  const visible = expanded ? entries : entries.slice(0, GLOBAL_SEARCH_QUERY_DISPLAY_LIMIT)
  return (
    <section aria-label={t('globalSearch.history.title')} className="max-h-[45%] shrink-0 overflow-y-auto px-5 pb-2">
      <div className="flex items-center justify-between gap-2 py-1 text-sm text-muted-foreground">
        <h2>{t('globalSearch.history.title')}</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onClear()
            onFocusInput()
          }}>
          {t('globalSearch.history.clear')}
        </Button>
      </div>
      {visible.map((entry, index) => (
        <div key={entry.query} className="flex min-w-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            id={getGlobalSearchOptionDomId(`query:${entry.query}`)}
            ref={(node) => {
              if (node) recallRefs.current.set(entry.query, node)
              else recallRefs.current.delete(entry.query)
            }}
            className="h-9 min-w-0 flex-1 justify-start gap-2 text-left font-normal"
            title={entry.query}
            onClick={() => onRecall(entry.query)}>
            <Clock3 className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{entry.query}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={t('globalSearch.history.remove', { query: entry.query })}
            onClick={() => {
              const next = visible[index + 1] ?? visible[index - 1]
              if (next) recallRefs.current.get(next.query)?.focus()
              else onFocusInput()
              onRemove(entry.query)
            }}>
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      {!expanded && entries.length > visible.length && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(true)}>
          {t('globalSearch.history.showAll')}
        </Button>
      )}
    </section>
  )
}
