import { Button, Input } from '@cherrystudio/ui'
import { History, Search, Zap } from 'lucide-react'
import type { FocusEvent, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import RecallHistoryList from './RecallHistoryList'
import { useRecallTest } from './RecallTestProvider'

const RecallSearchBar = () => {
  const { t } = useTranslation()
  const {
    state: { query, historyItems, isHistoryOpen, isSearching },
    actions: { setQuery, setHistoryOpen, runSearch }
  } = useRecallTest()
  const canSearch = query.trim().length > 0 && !isSearching
  const hasHistory = historyItems.length > 0

  const closeHistoryOnInputBlur = (event: FocusEvent<HTMLInputElement>) => {
    const nextFocusedElement = event.relatedTarget

    if (nextFocusedElement instanceof HTMLElement && nextFocusedElement.closest('[data-recall-history]')) {
      return
    }

    setHistoryOpen(false)
  }

  const keepInputFocus = (event: MouseEvent) => {
    event.preventDefault()
  }

  return (
    <div className="shrink-0 px-3 pt-3 pb-2">
      <div className="flex items-center gap-1.5">
        <div className="relative flex flex-1 items-center gap-1.5 rounded-lg border border-border/40 bg-muted/20 px-2.5 py-1.25 transition-all focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/15">
          <Search className="size-3 shrink-0 text-muted-foreground/35" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setHistoryOpen(hasHistory)}
            onBlur={closeHistoryOnInputBlur}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSearch) {
                runSearch()
                setHistoryOpen(false)
              }
            }}
            placeholder={t('knowledge.recall.placeholder')}
            className="h-auto flex-1 border-0 bg-transparent px-0 py-0 text-foreground text-sm leading-5 shadow-none placeholder:text-muted-foreground/30 placeholder:text-sm focus-visible:border-0 focus-visible:ring-0"
          />
          {hasHistory ? (
            <Button
              type="button"
              variant="ghost"
              tabIndex={-1}
              className={`min-h-0 shrink-0 rounded-none p-0 shadow-none transition-colors hover:bg-transparent hover:text-foreground ${isHistoryOpen ? 'text-primary' : 'text-muted-foreground/30'}`}
              onMouseDown={keepInputFocus}
              onClick={(event) => {
                event.stopPropagation()
                setHistoryOpen(!isHistoryOpen)
              }}
              aria-label={t('knowledge.recall.history_title')}>
              <History className="size-3" />
            </Button>
          ) : null}

          {hasHistory && isHistoryOpen ? (
            <div
              data-recall-history
              className="absolute top-full right-0 left-0 z-300 mt-1 max-h-45 overflow-y-auto rounded-lg border border-border/40 bg-popover p-1 shadow-lg [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-0.75"
              onMouseDown={keepInputFocus}>
              <RecallHistoryList />
            </div>
          ) : null}
        </div>

        <Button
          type="button"
          disabled={!canSearch}
          className="h-7 min-h-7 shrink-0 rounded-lg bg-primary px-3 text-sm text-white leading-5 shadow-none transition-all hover:bg-primary-hover active:scale-[0.97] disabled:opacity-40"
          onClick={() => {
            runSearch()
            setHistoryOpen(false)
          }}>
          <Zap className="size-2.5" />
          {t('knowledge.recall.submit')}
        </Button>
      </div>
    </div>
  )
}

export default RecallSearchBar
