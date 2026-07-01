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
    <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
      {/* Inset focus ring: an outset ring is painted outside the wrapper's box and gets
          clipped by the panel's `overflow-x-hidden` ancestor (and overlapped by the open
          history dropdown), leaving the lower/right edge incomplete. Drawing it inset keeps
          the whole focus border within the wrapper, so it always renders fully. */}
      <div className="relative flex flex-1 items-center gap-1.5 rounded-lg border border-border-subtle bg-background px-2.5 py-1.25 transition-all focus-within:border-border-active focus-within:ring-1 focus-within:ring-ring/50 focus-within:ring-inset">
        <Search className="size-3.5 shrink-0 text-foreground-muted" />
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
          className="h-auto flex-1 border-0 bg-transparent px-0 py-0 text-foreground text-sm leading-5 shadow-none placeholder:text-foreground-muted placeholder:text-sm focus-visible:border-0 focus-visible:ring-0"
        />
        {hasHistory ? (
          <Button
            type="button"
            variant="ghost"
            tabIndex={-1}
            className={`min-h-0 shrink-0 rounded-none p-0 shadow-none transition-colors hover:bg-transparent hover:text-foreground ${isHistoryOpen ? 'text-primary' : 'text-foreground-muted'}`}
            onMouseDown={keepInputFocus}
            onClick={(event) => {
              event.stopPropagation()
              setHistoryOpen(!isHistoryOpen)
            }}
            aria-label={t('knowledge.recall.history_title')}>
            <History className="size-3.5" />
          </Button>
        ) : null}

        {hasHistory && isHistoryOpen ? (
          <div
            data-recall-history
            className="absolute start-0 end-0 top-full z-300 mt-1 max-h-45 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-muted [&::-webkit-scrollbar]:w-0.75"
            onMouseDown={keepInputFocus}>
            <RecallHistoryList />
          </div>
        ) : null}
      </div>

      <Button
        type="button"
        variant="default"
        size="sm"
        disabled={!canSearch}
        onClick={() => {
          runSearch()
          setHistoryOpen(false)
        }}>
        <Zap className="size-3.5" />
        {t('knowledge.recall.submit')}
      </Button>
    </div>
  )
}

export default RecallSearchBar
