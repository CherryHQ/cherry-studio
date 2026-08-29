import { SearchInput } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { useLocation, useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  moveActiveIndex,
  requestJump,
  setLiveQuery,
  SETTINGS_SEARCH_LISTBOX_ID,
  settingsSearchOptionDomId,
  useSettingsSearchKeyboard
} from './store'

const SEARCH_DEBOUNCE_MS = 150

/**
 * Sidebar search input. Local state echoes keystrokes instantly; the URL is a
 * debounced mirror (per-keystroke navigation would re-persist the whole tab
 * list through the TabRouter sync loop). First debounced entry pushes onto
 * history, subsequent ones replace, so back returns to the origin section.
 */
const SettingsSearchBox = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const router = useRouter()
  const search = useSearch({ strict: false })
  const { t } = useTranslation()

  const isSearchPage = location.pathname === '/settings/search'
  const urlQuery = isSearchPage && typeof search.q === 'string' ? search.q : ''
  const { activeIndex, resultCount } = useSettingsSearchKeyboard()
  const hasResults = isSearchPage && resultCount > 0
  const [value, setValue] = useState(urlQuery)
  // Tracks the previous input value across effect passes — distinguishes a
  // user-initiated clear from a deep-link seed still in flight
  const prevValueRef = useRef(value)
  // A deep link lands on the search page with the URL already on the history
  // stack, so the first debounced navigate must replace, not push
  const hasPushedRef = useRef(isSearchPage)

  // Navigation that does not end on the search page (menu click, result jump)
  // drops pending keystrokes — else the debounce timer hijacks the trip later
  const prevPathnameRef = useRef(location.pathname)
  useEffect(() => {
    const pathnameChanged = prevPathnameRef.current !== location.pathname
    prevPathnameRef.current = location.pathname
    if (!pathnameChanged) return
    if (!isSearchPage && value) {
      setValue('')
      setLiveQuery('')
      hasPushedRef.current = false
    }
  }, [location.pathname, isSearchPage, value])

  // External URL updates (history back/forward, deep links in the same tab)
  // sync back into the box. Our own debounced mirrors land as urlQuery ===
  // value.trim() and are ignored. Runs only on urlQuery changes, never while
  // the user is typing ahead of the debounce.
  useEffect(() => {
    if (urlQuery === value.trim()) return
    setValue(urlQuery)
    setLiveQuery(urlQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery])

  const exitSearch = () => {
    // Only leave when the user actually searched: an empty-box Esc or one
    // before the debounce pushed must not walk the history back.
    const shouldLeave = hasPushedRef.current || isSearchPage
    setValue('')
    setLiveQuery('')
    hasPushedRef.current = false
    if (!shouldLeave) return
    if (router.history.canGoBack()) router.history.back()
    else void navigate({ to: '/settings/general' })
  }

  useEffect(() => {
    const trimmed = value.trim()
    const wasNonEmpty = prevValueRef.current.trim().length > 0
    prevValueRef.current = value
    if (!trimmed) {
      // Guard: a deep-link dispatch lands with the seed setValue still in
      // flight (value reads '' for one pass); only a real user clear may go back.
      if (isSearchPage && wasNonEmpty) {
        if (router.history.canGoBack()) router.history.back()
        else void navigate({ to: '/settings/general' })
      }
      return
    }

    const handle = setTimeout(() => {
      void navigate({
        to: '/settings/search',
        search: { q: trimmed },
        replace: hasPushedRef.current
      })
      hasPushedRef.current = true
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [value, navigate, isSearchPage, router])

  return (
    <div className="px-2.5 pb-1">
      <SearchInput
        size="sm"
        value={value}
        placeholder={t('settings.search.placeholder')}
        aria-label={t('settings.search.placeholder')}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={hasResults}
        aria-controls={isSearchPage ? SETTINGS_SEARCH_LISTBOX_ID : undefined}
        aria-activedescendant={hasResults ? settingsSearchOptionDomId(activeIndex) : undefined}
        className={cn(isSearchPage && 'border-primary')}
        onChange={(e) => {
          setValue(e.target.value)
          // Immediate pre-debounce mirror: the results page ranks against the
          // live query so Enter never jumps on stale (pre-keystroke) results
          setLiveQuery(e.target.value)
        }}
        onClear={exitSearch}
        clearLabel={t('common.clear')}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            moveActiveIndex(1)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            moveActiveIndex(-1)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            requestJump()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            exitSearch()
          }
        }}
      />
    </div>
  )
}

export default SettingsSearchBox
