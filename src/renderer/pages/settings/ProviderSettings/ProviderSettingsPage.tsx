import { Alert, Button, Spinner } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { useProviders } from '@renderer/hooks/useProvider'
import type { Provider } from '@shared/data/types/provider'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { omit } from 'es-toolkit/compat'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useProviderDeepLinkImport } from './hooks/useProviderDeepLinkImport'
import { ProviderList } from './ProviderList'
import ProviderSetting from './ProviderSetting'
import { isProviderSettingsListVisibleProvider } from './utils/providerDisplay'

interface ProviderSettingsPageProps {
  isOnboarding?: boolean
}

interface ProviderSettingsSearch {
  addProviderData?: string
  filter?: string
  id?: string
}

interface ProviderSettingsContentProps extends ProviderSettingsPageProps {
  rawProviders: Provider[]
}

function ProviderSettingsContent({ isOnboarding = false, rawProviders }: ProviderSettingsContentProps) {
  const search = useSearch({ strict: false }) as ProviderSettingsSearch
  const navigate = useNavigate()
  const [lastSelectedProviderId, setLastSelectedProviderId] = usePersistCache(
    'settings.provider.last_selected_provider_id'
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
      />
      {selectedProvider && (
        <ProviderSetting providerId={selectedProvider.id} key={selectedProvider.id} isOnboarding={isOnboarding} />
      )}
    </div>
  )
}

export default function ProviderSettingsPage({ isOnboarding = false }: ProviderSettingsPageProps) {
  const { t } = useTranslation()
  const { providers, hasLoaded, isLoading, error, refetch } = useProviders()

  if (error && !hasLoaded) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <Alert
          type="error"
          showIcon
          message={t('common.error')}
          description={error.message}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              {t('common.retry')}
            </Button>
          }
          className="max-w-lg rounded-md px-4 py-3 shadow-none"
        />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <Spinner text={t('common.loading')} />
      </div>
    )
  }

  return <ProviderSettingsContent isOnboarding={isOnboarding} rawProviders={providers} />
}
