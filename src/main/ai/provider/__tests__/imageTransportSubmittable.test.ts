import {
  ImageGenerationOverrideSchema,
  ImageGenerationSupportSchema,
  resolveImageGenerationSupport
} from '@cherrystudio/provider-registry'
import { describe, expect, it } from 'vitest'

import models from '../../../../../packages/provider-registry/data/models.json'
import providerModels from '../../../../../packages/provider-registry/data/provider-models.json'
import { captureImageRequest } from '../custom/__tests__/boundary/captureRequest'
import { imageTransportDescriptorFor } from '../custom/imageTransport'
import { createNativeImageTransport, resolveNativeImageTarget } from '../custom/imageTransportRegistry'
import { imageCapabilityCases } from './imageCatalogFixtures'

const nativeProviders = new Set(['ppio', 'dashscope', 'tokenhub', 'modelscope'])
const settings = { apiKey: 'test', baseURL: 'https://example.invalid', imageBaseURL: 'https://example.invalid' }
const presetById = new Map(models.models.map((model) => [model.id, model]))
const declarations = providerModels.overrides.flatMap((override) => {
  if (!nativeProviders.has(override.providerId)) return []
  const preset = presetById.get(override.modelId)
  const support = resolveImageGenerationSupport(
    { imageGeneration: ImageGenerationSupportSchema.optional().parse(preset?.imageGeneration) },
    { imageGeneration: ImageGenerationOverrideSchema.optional().parse(override.imageGeneration) }
  )
  if (!support) return []
  // ProviderRegistryService materializes absent apiModelId from the canonical modelId.
  const modelId = override.apiModelId ?? override.modelId
  return imageCapabilityCases(support).map(({ operation, hasImages, capability }) => {
    return {
      providerId: override.providerId,
      modelId,
      operation,
      hasImages,
      inputCount: hasImages ? Math.max(1, capability.inputs.images.min) : 0,
      descriptor: imageTransportDescriptorFor(modelId, operation, support, hasImages)
    }
  })
})

describe('every served native image operation is executable', () => {
  // This is catalog reachability, not a vendor-response oracle; protocol tests validate wire contracts separately.
  it.each(declarations)(
    '$providerId / $modelId ($operation, images=$hasImages)',
    async ({ providerId, modelId, descriptor, inputCount }) => {
      const resolution = resolveNativeImageTarget(providerId, modelId, descriptor)
      expect(resolution.kind).toBe('custom')
      if (resolution.kind !== 'custom') throw new Error(`Unexecutable registry operation: ${providerId}/${modelId}`)
      const transport = await createNativeImageTransport({
        ...resolution.target,
        settings
      })
      const request = await captureImageRequest(transport, {
        modelId,
        modelDescriptor: descriptor,
        prompt: 'a cat',
        n: 1,
        size: undefined,
        seed: undefined,
        files: Array.from({ length: inputCount }, () => ({
          type: 'url' as const,
          url: 'https://images.example/input.png'
        })),
        mask: undefined,
        providerParams: {}
      })
      expect(request.url).toBe(`https://example.invalid${descriptor ? descriptor.endpoint : '/v1/images/generations'}`)
      expect(request.method).toBe('POST')
    }
  )
})
