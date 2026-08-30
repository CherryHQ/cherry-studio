import { useLocation, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect } from 'react'

import { setPendingFocus } from './store'

/**
 * URL → focus-intent translator mounted in the settings layout: reads a
 * `?focus=<dom anchor id>` param from any settings route, forwards it into the
 * store's pendingFocus (the same seam the search results use) and strips the
 * one-shot param so refreshes and shared links stay clean.
 */
const SettingsFocusUrl = () => {
  const search = useSearch({ strict: false })
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const focus = (search as Record<string, unknown>).focus
    // Empty string included: a blank anchor must not reach querySelector('#')
    if (typeof focus !== 'string' || !focus) return
    setPendingFocus(focus)
    void navigate({
      to: location.pathname,
      // Commit-time strip composes with concurrent param consumers (provider's
      // ?id= strip); a render-time snapshot could resurrect removed params
      search: (prev: Record<string, unknown>) => {
        const rest = { ...prev }
        delete rest.focus
        return rest
      },
      replace: true
    })
  }, [search, location.pathname, navigate])

  return null
}

export default SettingsFocusUrl
