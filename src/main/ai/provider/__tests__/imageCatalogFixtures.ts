import {
  ImageGenerationOverrideSchema,
  ImageGenerationSupportSchema,
  ImageOperationSchema,
  resolveImageCapability,
  resolveImageGenerationSupport
} from '@cherrystudio/provider-registry'
import type { ImageGenerationSupport, ImageOperation } from '@shared/data/types/model'

import models from '../../../../../packages/provider-registry/data/models.json'
import providerModels from '../../../../../packages/provider-registry/data/provider-models.json'
import { imageTransportDescriptorFor } from '../custom/imageTransport'

/** Use the production merge so provider differences are never mistaken for complete capabilities. */
export function registryImageSupport(providerId: string, apiModelId: string) {
  // ProviderRegistryService materializes an omitted apiModelId from the canonical modelId.
  const row = providerModels.overrides.find(
    (entry) => entry.providerId === providerId && (entry.apiModelId ?? entry.modelId) === apiModelId
  )
  if (!row) throw new Error(`Missing registry fixture: ${providerId}/${apiModelId}`)
  const base = models.models.find((model) => model.id === row.modelId)
  return resolveImageGenerationSupport(
    { imageGeneration: ImageGenerationSupportSchema.optional().parse(base?.imageGeneration) },
    { imageGeneration: ImageGenerationOverrideSchema.optional().parse(row.imageGeneration) }
  )
}

export function registryImageDescriptor(
  providerId: string,
  apiModelId: string,
  operation: ImageOperation = 'generate',
  hasImages = false
) {
  const support = registryImageSupport(providerId, apiModelId)
  const descriptor = imageTransportDescriptorFor(apiModelId, operation, support, hasImages)
  if (!descriptor) throw new Error(`Missing registry descriptor: ${providerId}/${apiModelId}/${operation}`)
  return descriptor
}

/** Cover supported operations with and without images, including input-specific protocol differences. */
export function imageCapabilityCases(support: ImageGenerationSupport) {
  return ImageOperationSchema.options.flatMap((operation) =>
    [false, true].flatMap((hasImages) => {
      const resolution = resolveImageCapability(support, operation, hasImages)
      if (resolution.kind !== 'supported') return []
      const { capability } = resolution
      const { min, max } = capability.inputs.images
      if ((!hasImages && min > 0) || (hasImages && max.kind === 'known' && max.value === 0)) return []
      return [{ operation, hasImages, capability }]
    })
  )
}
