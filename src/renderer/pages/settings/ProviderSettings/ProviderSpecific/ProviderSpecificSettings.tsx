import { useProvider } from '@renderer/hooks/useProvider'
import { Fragment } from 'react'

import { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import { PROVIDER_SPECIFIC_SETTINGS_REGISTRY, type ProviderSpecificPlacement } from './providerSpecificSettingsRegistry'

interface ProviderSpecificSettingsProps {
  providerId: string
  placement: ProviderSpecificPlacement
}

export default function ProviderSpecificSettings({ providerId, placement }: ProviderSpecificSettingsProps) {
  const { provider } = useProvider(providerId)
  const meta = useProviderMeta(providerId)

  if (!provider) {
    return null
  }

  return (
    <>
      {PROVIDER_SPECIFIC_SETTINGS_REGISTRY[placement]
        .filter((entry) => entry.when({ provider, meta }))
        .map((entry) => (
          <Fragment key={entry.key}>{entry.render(provider.id)}</Fragment>
        ))}
    </>
  )
}
