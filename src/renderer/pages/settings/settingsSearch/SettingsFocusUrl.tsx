import { useLocation, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect } from 'react'

import { setPendingFocus } from './store'

/**
 * URL → focus-intent translator mounted in the settings layout: reads a
 * `?focusId=<dom anchor id>` param from any settings route, forwards it into
 * the store's pendingFocus (the same seam the search results use) and strips
 * the one-shot param so refreshes and shared links stay clean. The key is
 * `focusId`, not `focus`: /settings/model already owns `?focus=default|translate`
 * to select its default/translate rows.
 */
const SettingsFocusUrl = () => {
  const search = useSearch({ strict: false })
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const focusId = (search as Record<string, unknown>).focusId
    // Empty string included: a blank anchor must not reach querySelector('#')
    if (typeof focusId !== 'string' || !focusId) return
    setPendingFocus(focusId)
    void navigate({
      to: location.pathname,
      // Commit-time strip composes with concurrent param consumers (provider's
      // ?id= strip); a render-time snapshot could resurrect removed params
      search: (prev: Record<string, unknown>) => {
        const rest = { ...prev }
        delete rest.focusId
        return rest
      },
      replace: true
    })
  }, [search, location.pathname, navigate])

  return null
}

export default SettingsFocusUrl
