import './assets/styles/tailwind-default-scope.css'

import { usePersistCache } from '@data/hooks/useCache'
import { useProviders } from '@renderer/hooks/useProviders'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useProviderDeepLinkImport } from './coordination/useProviderDeepLinkImport'
import ProviderList from './ProviderList'
import ProviderSetting from './ProviderSetting'
import { isProviderSettingsListVisibleProvider } from './utils/provider'

interface ProviderSettingsPageProps {
  isOnboarding?: boolean
}

interface ProviderSettingsSearch {
  addProviderData?: string
  filter?: string
  id?: string
}

export default function ProviderSettingsPage({ isOnboarding = false }: ProviderSettingsPageProps) {
  const search = useSearch({ from: '/settings/provider-v2' }) as ProviderSettingsSearch
  const navigate = useNavigate()
  const { providers: rawProviders } = useProviders()
  const [lastSelectedProviderId, setLastSelectedProviderId] = usePersistCache(
    'ui.provider_settings.last_selected_provider_id'
  )
  const [selectedProviderId, setSelectedProviderIdState] = useState<string | undefined>(
    () => lastSelectedProviderId ?? undefined
  )
  const setLastSelectedProviderIdRef = useRef(setLastSelectedProviderId)

  const providers = useMemo(() => (Array.isArray(rawProviders) ? rawProviders : []), [rawProviders])
  const visibleProviders = useMemo(() => providers.filter(isProviderSettingsListVisibleProvider), [providers])
  const filterModeHint = search.filter === 'agent' ? 'agent' : undefined

  useEffect(() => {
    setLastSelectedProviderIdRef.current = setLastSelectedProviderId
  }, [setLastSelectedProviderId])

  useEffect(() => {
    const persistedProviderId = lastSelectedProviderId ?? undefined
    setSelectedProviderIdState((currentProviderId) =>
      currentProviderId === persistedProviderId ? currentProviderId : persistedProviderId
    )
  }, [lastSelectedProviderId])

  const setSelectedProviderId = useCallback((providerId: string | undefined) => {
    setLastSelectedProviderIdRef.current(providerId ?? null)
    startTransition(() => setSelectedProviderIdState(providerId))
  }, [])

  useProviderDeepLinkImport(search.addProviderData, setSelectedProviderId)

  useEffect(() => {
    let shouldConsume = false

    if (search.filter === 'agent') {
      shouldConsume = true
    }

    if (search.id) {
      const provider = visibleProviders.find((item) => item.id === search.id)
      setSelectedProviderId(provider?.id ?? visibleProviders[0]?.id)
      shouldConsume = true
    }

    if (shouldConsume) {
      const restSearch = Object.fromEntries(Object.entries(search).filter(([key]) => key !== 'filter' && key !== 'id'))
      void navigate({ to: '/settings/provider-v2', search: restSearch as Record<string, string>, replace: true })
    }
  }, [navigate, search, setSelectedProviderId, visibleProviders])

  useEffect(() => {
    if (!selectedProviderId && visibleProviders[0]) {
      setSelectedProviderId(visibleProviders[0].id)
      return
    }

    if (selectedProviderId && !visibleProviders.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(visibleProviders[0]?.id)
    }
  }, [selectedProviderId, setSelectedProviderId, visibleProviders])

  const selectedProvider = useMemo(
    () => visibleProviders.find((provider) => provider.id === selectedProviderId),
    [selectedProviderId, visibleProviders]
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
