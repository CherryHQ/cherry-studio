import { ImageGenerationSupportSchema } from '@cherrystudio/provider-registry'
import type { ImageGenerationMode } from '@shared/data/types/model'

import providerModels from '../../../../../packages/provider-registry/data/provider-models.json'
import { imageTransportDescriptorFor } from '../custom/imageTransport'

/** Resolve fixtures from the producer so API IDs, endpoints and operation declarations cannot drift separately. */
export function registryImageDescriptor(
  providerId: string,
  apiModelId: string,
  mode: ImageGenerationMode = 'generate'
) {
  // ProviderRegistryService materializes an omitted apiModelId from the canonical modelId.
  const row = providerModels.overrides.find(
    (entry) => entry.providerId === providerId && (entry.apiModelId ?? entry.modelId) === apiModelId
  )
  if (!row) throw new Error(`Missing registry fixture: ${providerId}/${apiModelId}`)
  const support = ImageGenerationSupportSchema.parse(row.imageGeneration)
  const descriptor = imageTransportDescriptorFor(apiModelId, mode, support)
  if (!descriptor) throw new Error(`Missing registry descriptor: ${providerId}/${apiModelId}/${mode}`)
  return descriptor
}
