import './assets/styles/tailwind-default-scope.css'

import { useProviders } from '@renderer/hooks/useProviders'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { startTransition, useCallback, useEffect, useMemo, useState } from 'react'

import { useProviderDeepLinkImport } from './coordination/useProviderDeepLinkImport'
import ProviderList from './ProviderList'
import ProviderSetting from './ProviderSetting'

interface ProviderSettingsPageProps {
  isOnboarding?: boolean
}

const LAST_SELECTED_PROVIDER_ID_KEY = 'provider-settings-v2:last-selected-provider-id'

function readLastSelectedProviderId(): string | undefined {
  try {
    return window.sessionStorage.getItem(LAST_SELECTED_PROVIDER_ID_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function rememberLastSelectedProviderId(providerId: string | undefined) {
  try {
    if (providerId) {
      window.sessionStorage.setItem(LAST_SELECTED_PROVIDER_ID_KEY, providerId)
    } else {
      window.sessionStorage.removeItem(LAST_SELECTED_PROVIDER_ID_KEY)
    }
  } catch {
    // Session storage is a convenience for this page-level UI state; ignore unavailable storage.
  }
}

export default function ProviderSettingsPage({ isOnboarding = false }: ProviderSettingsPageProps) {
  const search = useSearch({ strict: false }) as Record<string, string | undefined>
  const navigate = useNavigate()
  const { providers: rawProviders } = useProviders()
  const [selectedProviderId, setSelectedProviderIdState] = useState<string | undefined>(() =>
    readLastSelectedProviderId()
  )

  const providers = useMemo(() => (Array.isArray(rawProviders) ? rawProviders : []), [rawProviders])
  const filterModeHint = search.filter === 'agent' ? 'agent' : undefined

  const setSelectedProviderId = useCallback((providerId: string | undefined) => {
    rememberLastSelectedProviderId(providerId)
    startTransition(() => setSelectedProviderIdState(providerId))
  }, [])

  useProviderDeepLinkImport(search.addProviderData, (providerId) => setSelectedProviderId(providerId))

  useEffect(() => {
    let shouldConsume = false

    if (search.filter === 'agent') {
      shouldConsume = true
    }

    if (search.id) {
      const provider = providers.find((item) => item.id === search.id)
      setSelectedProviderId(provider?.id ?? providers[0]?.id)
      shouldConsume = true
    }

    if (shouldConsume) {
      const restSearch = Object.fromEntries(Object.entries(search).filter(([key]) => key !== 'filter' && key !== 'id'))
      void navigate({ to: '/settings/provider-v2', search: restSearch as Record<string, string>, replace: true })
    }
  }, [navigate, providers, search, setSelectedProviderId])

  useEffect(() => {
    if (!selectedProviderId && providers[0]) {
      setSelectedProviderId(providers[0].id)
      return
    }

    if (selectedProviderId && !providers.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(providers[0]?.id)
    }
  }, [providers, selectedProviderId, setSelectedProviderId])

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId),
    [providers, selectedProviderId]
  )

  return (
    <div className="provider-settings-default-scope provider-settings-layout-cq relative flex h-full min-h-0 w-full min-w-0 overflow-hidden bg-(--color-background)">
      <ProviderList
        selectedProviderId={selectedProviderId}
        filterModeHint={filterModeHint}
        onSelectProvider={setSelectedProviderId}
      />
      {selectedProvider && (
        <ProviderSetting providerId={selectedProvider.id} key={selectedProvider.id} isOnboarding={isOnboarding} />
      )}
    </div>
  )
}
