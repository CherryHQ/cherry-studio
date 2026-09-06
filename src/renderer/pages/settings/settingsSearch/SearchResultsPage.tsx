import HighlightText from '@renderer/components/HighlightText'
import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import { cn } from '@renderer/utils/style'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { settingsSearchSections } from './aggregate'
import { rankEntries } from './searchEngine'
import { useSettingsSearchDomIds } from './SettingsSearchDomIds'
import { publishResults, registerJumpHandler, setPendingFocus, useSettingsSearchKeyboard } from './store'

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
  // en-US is the catalog source of truth; scoring it at the alias tier lets
  // "skill"/"proxy" find 技能/代理 in any UI language. useSuspense:false renders
  // immediately while the lazy pack loads; gating on the bundle skips scoring
  // until then (the engine would drop key-literals, but this also avoids the
  // missing-key log burst).
  const { t: tEn, i18n } = useTranslation(undefined, { lng: 'en-US', useSuspense: false })
  const tEnReady = i18n.hasResourceBundle('en-US', 'translation') ? tEn : undefined
  const { activeIndex, liveQuery } = useSettingsSearchKeyboard()
  const { listboxId, optionDomId } = useSettingsSearchDomIds()
  const listRef = useRef<HTMLDivElement>(null)

  const urlQuery = typeof search.q === 'string' ? search.q : ''
  // Rank against the live (pre-debounce) query when the box has spoken; the URL
  // value only seeds the very first frame of a deep link, before the box's
  // sync effect runs
  const query = liveQuery ?? urlQuery
  const results = useMemo(() => rankEntries(query, settingsSearchSections, t, tEnReady), [query, t, tEnReady])

  useEffect(() => {
    publishResults(results.length)
  }, [results])

  const goTo = useCallback(
    (index: number) => {
      const result = results[index]
      if (!result) return
      setPendingFocus(result.focusId)
      const search: Record<string, string> = {}
      if (result.panel) search.panel = result.panel
      if (result.providerId) search.id = result.providerId
      void navigate({ to: result.route, search: Object.keys(search).length ? search : undefined })
    },
    [results, navigate]
  )

  useEffect(() => registerJumpHandler(goTo), [goTo])

  // Keep the keyboard-selected row in view
  useEffect(() => {
    listRef.current?.querySelector(`#${optionDomId(activeIndex)}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, optionDomId])

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
        id={listboxId}
        aria-label={t('settings.search.results')}
        className="flex flex-col gap-0.5"
        data-ui="settings.search.results">
        {results.map((result, index) => (
          <button
            key={`${result.route}-${result.focusId ?? 'section'}-${index}`}
            id={optionDomId(index)}
            type="button"
            role="option"
            // Combobox owns the focus (aria-activedescendant model): options stay
            // pointer-reachable but must not join the tab order
            tabIndex={-1}
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
