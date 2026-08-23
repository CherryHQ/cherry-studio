import HighlightText from '@renderer/components/HighlightText'
import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import { cn } from '@renderer/utils/style'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { settingsSearchSections } from './aggregate'
import { rankEntries } from './searchEngine'
import { publishResults, registerJumpHandler, setPendingFocus, useSettingsSearchKeyboard } from './store'

const optionDomId = (index: number) => `settings-search-option-${index}`

/**
 * Results page for the hidden /settings/search route. Flat list of ranked
 * entries: highlighted title, section breadcrumb, description preview.
 * Keyboard selection lives in the shared store; Enter/click navigates to the
 * target section with a pending focus id for scroll + flash.
 */
const SearchResultsPage = () => {
  const navigate = useNavigate()
  const search = useSearch({ from: '/settings/search' })
  const { t } = useTranslation()
  const { activeIndex } = useSettingsSearchKeyboard()
  const listRef = useRef<HTMLDivElement>(null)

  const query = typeof search.q === 'string' ? search.q : ''
  const results = useMemo(() => rankEntries(query, settingsSearchSections, t), [query, t])

  useEffect(() => {
    publishResults(results.length)
  }, [results])

  const goTo = useCallback(
    (index: number) => {
      const result = results[index]
      if (!result) return
      setPendingFocus(result.focusId)
      void navigate({ to: result.route, search: result.panel ? { panel: result.panel } : undefined })
    },
    [results, navigate]
  )

  useEffect(() => registerJumpHandler(goTo), [goTo])

  // Keep the keyboard-selected row in view
  useEffect(() => {
    listRef.current?.querySelector(`#${optionDomId(activeIndex)}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (!results.length) {
    return (
      <SettingsContentColumn>
        <p className="mt-16 text-center text-muted-foreground text-sm">{t('settings.search.noResults')}</p>
      </SettingsContentColumn>
    )
  }

  return (
    <SettingsContentColumn>
      <div
        ref={listRef}
        role="listbox"
        aria-label={t('settings.search.results')}
        className="flex flex-col gap-0.5"
        data-ui="settings.search.results">
        {results.map((result, index) => (
          <button
            key={`${result.route}-${result.focusId ?? 'section'}-${index}`}
            id={optionDomId(index)}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className={cn(
              'flex flex-col items-start gap-0.5 rounded-[10px] border border-transparent px-3 py-2 text-left hover:bg-muted',
              index === activeIndex && 'border-transparent bg-muted'
            )}
            onClick={() => goTo(index)}>
            <span className="flex w-full items-baseline justify-between gap-2">
              <span className="truncate font-medium text-sm">
                <HighlightText text={result.title} keyword={query} />
              </span>
              <span className="shrink-0 text-muted-foreground text-xs">{result.breadcrumb.join(' › ')}</span>
            </span>
            {result.description && (
              <span className="w-full truncate text-muted-foreground text-xs">{result.description}</span>
            )}
          </button>
        ))}
      </div>
    </SettingsContentColumn>
  )
}

export { SearchResultsPage }
