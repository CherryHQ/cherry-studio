import { getProviderHostTopology } from '@renderer/pages/settings/ProviderSettings/utils/providerTopology'
import type { Provider } from '@shared/data/types/provider'

import type { ApiKeysData } from './types'

export function getModelSyncSignature(provider: Provider, apiKeysData: ApiKeysData | undefined) {
  const topology = getProviderHostTopology(provider)
  const keyFingerprint = (apiKeysData?.keys ?? [])
    .filter((key) => key.isEnabled)
    .map((key) => key.key)
    .join(',')

  return [
    provider.id,
    provider.authType,
    topology.primaryEndpoint,
    topology.primaryBaseUrl,
    topology.anthropicBaseUrl,
    keyFingerprint
  ].join('|')
}
