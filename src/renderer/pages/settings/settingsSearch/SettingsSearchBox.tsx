import { useLocation, useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SearchInput } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'

import { useSettingsSearchDomIds } from './SettingsSearchDomIds'
import { moveActiveIndex, requestJump, setLiveQuery, useSettingsSearchKeyboard } from './store'

const SEARCH_DEBOUNCE_MS = 150

/**
 * Sidebar search field. Local state echoes keystrokes instantly; the URL is a
 * debounced mirror (per-keystroke navigation would re-persist the whole tab
 * list through the TabRouter sync loop). First debounced entry pushes onto
 * history, subsequent ones replace, so back returns to the origin section.
 * Mounted only while a search session is active — the collapse decision (icon
 * state) lives in the settings page; this component reports closing moments
 * through onCollapse.
 */
const SettingsSearchBox = ({ onCollapse }: { onCollapse: () => void }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const router = useRouter()
  const search = useSearch({ strict: false })
  const { t } = useTranslation()

  const isSearchPage = location.pathname === '/settings/search'
  const urlQuery = isSearchPage && typeof search.q === 'string' ? search.q : ''
  const { activeIndex, resultCount } = useSettingsSearchKeyboard()
  const { listboxId, optionDomId } = useSettingsSearchDomIds()
  const hasResults = isSearchPage && resultCount > 0
  const [value, setValue] = useState(urlQuery)
  const inputRef = useRef<HTMLInputElement>(null)
  // URL seeds, Activity re-shows and pathname resets are not user clears.
  const clearIntentRef = useRef(false)
  // A deep link lands on the search page with the URL already on the history
  // stack, so the first debounced navigate must replace, not push
  const hasPushedRef = useRef(isSearchPage)
  // Distinguishes a new external URL value from an <Activity> re-show re-run
  // (unchanged urlQuery) that must not clobber input typed during the hide
  const appliedUrlRef = useRef(urlQuery)
  // A second dismissal would overwrite the panel that back() returns to.
  const leaveInFlightRef = useRef(false)
  // Debounce handle kept reachable so Enter can flush the navigation early
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Navigation that does not end on the search page (menu click, result jump)
  // drops pending keystrokes — else the debounce timer hijacks the trip later
  const prevPathnameRef = useRef(location.pathname)
  useEffect(() => {
    const pathnameChanged = prevPathnameRef.current !== location.pathname
    prevPathnameRef.current = location.pathname
    if (!pathnameChanged) return
    if (isSearchPage) {
      // Any arrival here (own push, back/forward) has the URL on the stack
      // already: the mirrored debounced navigate must replace, not duplicate
      hasPushedRef.current = true
      leaveInFlightRef.current = false
      return
    }
    // Reset even on empty-value exits (the back path skips the value check):
    // a stale true downgrades the next session's first entry to replace
    hasPushedRef.current = false
    leaveInFlightRef.current = false
    // Leaving the search page ends the search flow — collapse back to icon
    onCollapse()
    if (value) {
      setValue('')
      setLiveQuery('')
    }
  }, [location.pathname, isSearchPage, value, onCollapse])

  // External URL updates (history back/forward, deep links in the same tab)
  // sync back into the box. Our own debounced mirrors land as urlQuery ===
  // value.trim() and are ignored; an unchanged urlQuery (Activity re-show)
  // must not clobber input typed during the hide window.
  useEffect(() => {
    if (urlQuery === appliedUrlRef.current) return
    appliedUrlRef.current = urlQuery
    if (urlQuery === value.trim()) return
    setValue(urlQuery)
    setLiveQuery(urlQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery])

  // Window-global store: hide/unmount clears it; Activity show re-runs this
  // with surviving state, re-publishing the input the hide phase cleared
  useEffect(() => {
    setLiveQuery(value || undefined)
    return () => setLiveQuery(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Only one dismissal may navigate while back() is still in flight.
  const performLeave = useCallback(() => {
    if (leaveInFlightRef.current) return
    leaveInFlightRef.current = true
    if (router.history.canGoBack()) router.history.back()
    else void navigate({ to: '/settings/general' })
  }, [router, navigate])

  const exitSearch = () => {
    // Only leave when the user actually searched: an empty-box Esc or one
    // before the debounce pushed must not walk the history back.
    const shouldLeave = hasPushedRef.current || isSearchPage
    setValue('')
    setLiveQuery('')
    hasPushedRef.current = false
    if (!shouldLeave) return
    performLeave()
  }

  const hasUrlQueryRef = useRef(false)
  // Snapshot before the mirror effect so it reads the current URL presence.
  useEffect(() => {
    hasUrlQueryRef.current = isSearchPage && 'q' in (search as Record<string, unknown>)
  }, [isSearchPage, search])

  useEffect(() => {
    const trimmed = value.trim()
    if (!trimmed) {
      const wasUserClear = clearIntentRef.current
      clearIntentRef.current = false
      if (wasUserClear) setLiveQuery('')
      if (isSearchPage && wasUserClear && !leaveInFlightRef.current && hasUrlQueryRef.current) {
        void navigate({
          to: '/settings/search',
          replace: true,
          search: (prev: Record<string, unknown>) => {
            const rest = { ...prev }
            delete rest.q
            return rest
          }
        })
      }
      return
    }
    // Typing again abandons any leave still in flight
    leaveInFlightRef.current = false

    debounceRef.current = setTimeout(() => {
      void navigate({
        to: '/settings/search',
        search: { q: trimmed },
        replace: hasPushedRef.current
      })
      hasPushedRef.current = true
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value, navigate, isSearchPage])

  // Expands horizontally over the header row at the standing box's width
  return (
    <div className="fade-in slide-in-from-right-2 w-full animate-in duration-150">
      <SearchInput
        ref={inputRef}
        autoFocus
        size="sm"
        // h-8 matches the header row height; sm keeps the compact text
        containerClassName="h-8"
        value={value}
        placeholder={t('settings.search.placeholder')}
        aria-label={t('settings.search.placeholder')}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={hasResults}
        aria-controls={hasResults ? listboxId : undefined}
        aria-activedescendant={hasResults ? optionDomId(activeIndex) : undefined}
        className={cn(isSearchPage && 'border-primary')}
        onChange={(e) => {
          const next = e.target.value
          if (!next.trim()) clearIntentRef.current = true
          setValue(next)
          // Immediate pre-debounce mirror: the results page ranks against the
          // live query so Enter never jumps on stale (pre-keystroke) results
          setLiveQuery(next)
        }}
        onClear={() => {
          clearIntentRef.current = true
          setValue('')
          setLiveQuery('')
          inputRef.current?.focus()
        }}
        clearLabel={t('common.clear')}
        onBlur={() => {
          if (!value && !isSearchPage) onCollapse()
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            moveActiveIndex(1)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            moveActiveIndex(-1)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (isSearchPage) {
              requestJump()
            } else if (value.trim()) {
              // Enter before the debounce lands must still respond: off the
              // search page the results list is not mounted, so flush the
              // navigation instead of jumping blind (second Enter jumps)
              if (debounceRef.current) clearTimeout(debounceRef.current)
              void navigate({
                to: '/settings/search',
                search: { q: value.trim() },
                replace: hasPushedRef.current
              })
              hasPushedRef.current = true
            }
          } else if (e.key === 'Escape') {
            e.preventDefault()
            exitSearch()
            if (!isSearchPage) onCollapse()
          }
        }}
      />
    </div>
  )
}

export default SettingsSearchBox
