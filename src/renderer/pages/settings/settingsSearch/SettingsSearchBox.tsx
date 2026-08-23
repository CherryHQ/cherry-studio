import { SearchInput } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { useLocation, useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { moveActiveIndex, requestJump } from './store'

const SEARCH_DEBOUNCE_MS = 150

/**
 * Sidebar search input. Local state echoes keystrokes instantly; the URL is a
 * debounced mirror (navigating per keystroke would re-persist the whole tab
 * list through the TabRouter sync loop on every key). First keystroke pushes
 * onto history, subsequent ones replace, so back returns to the origin page.
 */
const SettingsSearchBox = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const router = useRouter()
  const search = useSearch({ strict: false })
  const { t } = useTranslation()

  const isSearchPage = location.pathname === '/settings/search'
  const initialQuery = typeof search.q === 'string' ? search.q : ''

  const [value, setValue] = useState(initialQuery)
  const hasPushedRef = useRef(false)

  // Deep link straight into the search page: seed the input from the URL once
  useEffect(() => {
    if (isSearchPage && initialQuery && !value) setValue(initialQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Leaving the search page (menu click or result jump) clears the input
  useEffect(() => {
    if (!isSearchPage && value) {
      setValue('')
      hasPushedRef.current = false
    }
  }, [isSearchPage, value])

  useEffect(() => {
    const trimmed = value.trim()
    if (!trimmed) return

    const handle = setTimeout(() => {
      navigate({
        to: '/settings/search',
        search: { q: trimmed },
        replace: hasPushedRef.current
      })
      hasPushedRef.current = true
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [value, navigate])

  const exitSearch = () => {
    setValue('')
    hasPushedRef.current = false
    if (router.history.canGoBack()) router.history.back()
    else navigate({ to: '/settings/general' })
  }

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
