import {
  applyImageCapabilityDelta,
  type ImageCapability,
  type ImageCapabilityDelta,
  type ImageGenerationSupport,
  ImageGenerationSupportSchema,
  type ImageOperation,
  ImageOperationSchema,
  type ModelConfig
} from '../schemas/model'
import type { ProviderModelOverride } from '../schemas/provider-models'

export type { ImageOperation } from '../schemas/model'
export { ImageOperationSchema } from '../schemas/model'
export type EffectiveImageCapability = ImageCapability

export type ImageCapabilityResolution =
  | { kind: 'unconfigured' }
  | { kind: 'unsupported' }
  | { kind: 'supported'; capability: EffectiveImageCapability }

/** Image inputs refine ordinary generation; they do not invent another operation. */
export function resolveImageCapability(
  support: ImageGenerationSupport | undefined,
  operation: ImageOperation,
  hasImages: boolean
): ImageCapabilityResolution {
  if (support === undefined) return { kind: 'unconfigured' }
  const operationDelta = support.operations?.[operation]
  if (operationDelta === null || (operation !== 'generate' && operationDelta === undefined)) {
    return { kind: 'unsupported' }
  }
  let capability: ImageCapability = { supports: support.supports, inputs: support.inputs, protocol: support.protocol }
  if (operation === 'generate' && hasImages && support.withImages) {
    capability = applyImageCapabilityDelta(capability, support.withImages)
  }
  if (operationDelta) capability = applyImageCapabilityDelta(capability, operationDelta)
  return { kind: 'supported', capability }
}

function mergeDifference(base: ImageCapabilityDelta | null | undefined, override: ImageCapabilityDelta | null) {
  if (override === null) return null
  return {
    ...base,
    ...override,
    supports: { ...base?.supports, ...override.supports },
    inputs: { ...base?.inputs, ...override.inputs, images: { ...base?.inputs?.images, ...override.inputs?.images } }
  }
}

/** Only image capabilities merge here; unrelated provider configuration keeps its own contract. */
export function resolveImageGenerationSupport(
  model: Pick<ModelConfig, 'imageGeneration'> | null,
  override: Pick<ProviderModelOverride, 'imageGeneration'> | null
): ImageGenerationSupport | undefined {
  const base = model?.imageGeneration
  const patch = override?.imageGeneration
  if (patch === undefined) return base
  if (base === undefined) {
    const empty = ImageGenerationSupportSchema.parse({ ...patch, supports: {} })
    return ImageGenerationSupportSchema.parse({ ...empty, ...applyImageCapabilityDelta(empty, patch) })
  }
  const capability = applyImageCapabilityDelta(base, patch)
  const operations = { ...base.operations }
  for (const operation of ImageOperationSchema.options) {
    const delta = patch.operations?.[operation]
    if (delta !== undefined) operations[operation] = mergeDifference(operations[operation], delta)
  }
  return ImageGenerationSupportSchema.parse({
    ...capability,
    withImages: patch.withImages === undefined ? base.withImages : mergeDifference(base.withImages, patch.withImages),
    operations
  })
}

/** Validate cross-file overrides before a generated or remotely published catalog can be accepted. */
export function validateProviderImageCapabilities(
  models: Pick<ModelConfig, 'id' | 'imageGeneration'>[],
  overrides: Pick<ProviderModelOverride, 'providerId' | 'modelId' | 'imageGeneration'>[]
): void {
  const modelsById = new Map(models.map((model) => [model.id, model]))
  for (const override of overrides) {
    try {
      resolveImageGenerationSupport(modelsById.get(override.modelId) ?? null, override)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Invalid image capability for ${override.providerId}/${override.modelId}: ${detail}`, {
        cause: error
      })
    }
  }
}
