import { createHash } from 'node:crypto'

import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { resolveAiSdkProviderId, resolveEffectiveEndpoint, resolveWireModelId } from '../../endpoint'

/** Fingerprint only execution identity; credentials and display metadata are resolved afresh. */
export function imageJobConnectionKey(provider: Provider, model: Model): string {
  const endpoint = resolveEffectiveEndpoint(provider, model)
  return createHash('sha256')
    .update(
      JSON.stringify([
        provider.id,
        provider.presetProviderId,
        provider.authType,
        resolveAiSdkProviderId(provider, endpoint.endpointType),
        resolveWireModelId(model, endpoint.endpointType),
        endpoint
      ])
    )
    .digest('hex')
}
