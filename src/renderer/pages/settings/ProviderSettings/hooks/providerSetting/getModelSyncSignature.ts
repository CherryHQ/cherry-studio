import type { Provider } from '@shared/data/types/provider'
import { getProviderHostTopology } from '@shared/utils/providerTopology'

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
