import { usePersistCache } from '@data/hooks/useCache'
import { useProviders } from '@renderer/hooks/useProvider'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { omit } from 'es-toolkit/compat'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ProviderApiSetupInitialStep } from './ConnectionSettings/ProviderApiSetupDialog'
import { useProviderDeepLinkImport } from './hooks/useProviderDeepLinkImport'
import { ProviderList } from './ProviderList'
import ProviderSetting from './ProviderSetting'
import { isProviderSettingsListVisibleProvider } from './utils/providerDisplay'

interface ProviderSettingsSearch {
  addProviderData?: string
  filter?: string
  id?: string
}

interface PendingApiSetup {
  providerId: string
  initialStep: ProviderApiSetupInitialStep
}

export default function ProviderSettingsPage() {
  const search = useSearch({ strict: false }) as ProviderSettingsSearch
  const navigate = useNavigate()
  const { providers: rawProviders } = useProviders()
  const [lastSelectedProviderId, setLastSelectedProviderId] = usePersistCache(
    'settings.provider.last_selected_provider_id'
  )
  const [selectedProviderId, setSelectedProviderIdState] = useState<string | undefined>(
    () => lastSelectedProviderId ?? undefined
  )
  const [pendingApiSetup, setPendingApiSetup] = useState<PendingApiSetup | null>(null)
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
    setPendingApiSetup((current) => (current?.providerId === providerId ? current : null))
    setLastSelectedProviderIdRef.current(providerId ?? null)
    startTransition(() => setSelectedProviderIdState(providerId))
  }, [])

  const handleCustomProviderCreated = useCallback((providerId: string, hasApiKey: boolean) => {
    setPendingApiSetup({ providerId, initialStep: hasApiKey ? 'models' : 'api-key' })
  }, [])

  const handleApiSetupClosed = useCallback((providerId: string) => {
    setPendingApiSetup((current) => (current?.providerId === providerId ? null : current))
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
      const restSearch = omit(search, ['filter', 'id'])
      void navigate({ to: '/settings/provider', search: restSearch as Record<string, string>, replace: true })
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
    <div className="relative flex h-full min-h-0 w-full min-w-0 overflow-hidden">
      <ProviderList
        selectedProviderId={selectedProviderId}
        filterModeHint={filterModeHint}
        onSelectProvider={setSelectedProviderId}
        onCustomProviderCreated={handleCustomProviderCreated}
      />
      {selectedProvider && (
        <ProviderSetting
          providerId={selectedProvider.id}
          key={selectedProvider.id}
          initialApiSetupStep={
            pendingApiSetup?.providerId === selectedProvider.id ? pendingApiSetup.initialStep : undefined
          }
          onApiSetupClosed={() => handleApiSetupClosed(selectedProvider.id)}
        />
      )}
    </div>
  )
}
