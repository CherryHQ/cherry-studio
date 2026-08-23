import { SearchInput } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { useLocation, useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { moveActiveIndex, requestJump } from './store'

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
  const [value, setValue] = useState(urlQuery)
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
    if (isSearchPage) {
      if (!value && urlQuery) setValue(urlQuery)
    } else if (value) {
      setValue('')
      hasPushedRef.current = false
    }
  }, [location.pathname, isSearchPage, value, urlQuery])

  const exitSearch = () => {
    // Only leave when the user actually searched: an empty-box Esc or one
    // before the debounce pushed must not walk the history back.
    const shouldLeave = hasPushedRef.current || isSearchPage
    setValue('')
    hasPushedRef.current = false
    if (!shouldLeave) return
    if (router.history.canGoBack()) router.history.back()
    else void navigate({ to: '/settings/general' })
  }

  useEffect(() => {
    const trimmed = value.trim()
    if (!trimmed) {
      // Cleared the box while viewing results: leave rather than showing a
      // stale list under an empty input
      if (isSearchPage) {
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
        className={cn(isSearchPage && 'border-primary')}
        onChange={(e) => setValue(e.target.value)}
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
