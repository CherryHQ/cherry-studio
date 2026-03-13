import { isLocalWebSearchProvider } from '@renderer/config/webSearch/provider'
import { useWebSearchProviders } from '@renderer/hooks/useWebSearchProviders'
import type { WebSearchProviderId } from '@renderer/types'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'

export type WebSearchSettingsView = 'general' | WebSearchProviderId

export const useWebSearchSettingsNavigation = () => {
  const { providers } = useWebSearchProviders()
  const navigate = useNavigate()
  const location = useLocation()

  const activeView = useMemo<WebSearchSettingsView>(() => {
    const path = location.pathname

    if (path === '/settings/websearch/general' || path === '/settings/websearch') {
      return 'general'
    }

    const activeProvider = providers.find((provider) => path === `/settings/websearch/provider/${provider.id}`)
    return activeProvider?.id || 'general'
  }, [location.pathname, providers])

  const apiProviders = useMemo(() => providers.filter((provider) => !isLocalWebSearchProvider(provider)), [providers])
  const localProviders = useMemo(() => providers.filter((provider) => isLocalWebSearchProvider(provider)), [providers])

  const goToGeneral = useCallback(() => {
    void navigate({ to: '/settings/websearch/general' })
  }, [navigate])

  const goToProvider = useCallback(
    (providerId: WebSearchProviderId) => {
      void navigate({ to: '/settings/websearch/provider/$providerId', params: { providerId } })
    },
    [navigate]
  )

  return {
    activeView,
    apiProviders,
    localProviders,
    goToGeneral,
    goToProvider
  }
}
