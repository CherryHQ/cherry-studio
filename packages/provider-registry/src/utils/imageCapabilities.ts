import type * as z from 'zod'

import type { ImageGenerationMode, ImageGenerationSupport, ImageModeDef, ModelConfig } from '../schemas/model'
import { ImageGenerationModeSchema } from '../schemas/model'
import type { ProviderModelOverride } from '../schemas/provider-models'

export const ImageOperationSchema = ImageGenerationModeSchema.exclude(['edit', 'merge'])
export type ImageOperation = z.infer<typeof ImageOperationSchema>

export interface EffectiveImageCapability {
  supports: ImageModeDef['supports']
  inputs: {
    images: { min: number; max: { kind: 'known'; value: number } | { kind: 'unknown' } }
    prompt: 'required' | 'optional'
  }
}

export type ImageCapabilityResolution =
  | { kind: 'unconfigured' }
  | { kind: 'unsupported' }
  | { kind: 'supported'; capability: EffectiveImageCapability }

/** Ordinary image input selects a legacy binding, not a different business operation. */
export function resolveImageCapability(
  support: ImageGenerationSupport | undefined,
  operation: ImageOperation,
  hasImages: boolean
):
  | Exclude<ImageCapabilityResolution, { kind: 'supported' }>
  | {
      kind: 'supported'
      capability: EffectiveImageCapability
      mode: ImageGenerationMode
    } {
  if (support === undefined) return { kind: 'unconfigured' }
  let mode: ImageGenerationMode = operation
  if (operation === 'generate') {
    if (support.modes.edit && (hasImages || !support.modes.generate)) mode = 'edit'
    else if (!support.modes.generate && support.modes.merge) mode = 'merge'
  }
  const resolution = resolveLegacyImageCapability(support, mode)
  if (resolution.kind !== 'supported') return resolution
  const capability = resolution.capability
  if (operation === 'generate' && support.modes.generate) {
    capability.inputs.images.min = 0
    const imageMode = support.modes.edit ? 'edit' : 'generate'
    const withImages = resolveLegacyImageCapability(support, imageMode)
    if (withImages.kind === 'supported') capability.inputs.images.max = withImages.capability.inputs.images.max
  }
  return { ...resolution, mode }
}

/** Select the sole declaration under the current catalog's whole-block override contract. */
export function resolveImageGenerationSupport(
  model: Pick<ModelConfig, 'imageGeneration'> | null,
  override: Pick<ProviderModelOverride, 'imageGeneration'> | null
): ImageGenerationSupport | undefined {
  if (override?.imageGeneration !== undefined) return override.imageGeneration
  return model?.imageGeneration
}

/** Interpret the legacy catalog at one boundary; an absent operation is never another operation. */
export function resolveLegacyImageCapability(
  support: ImageGenerationSupport | undefined,
  mode: ImageGenerationMode
): ImageCapabilityResolution {
  if (support === undefined) return { kind: 'unconfigured' }
  const declaration = support.modes[mode]
  if (declaration === undefined) return { kind: 'unsupported' }

  return {
    kind: 'supported',
    capability: {
      supports: declaration.supports,
      inputs: {
        images: {
          min: mode === 'generate' ? 0 : mode === 'merge' ? 2 : 1,
          max:
            declaration.maxInputImages === undefined
              ? { kind: 'unknown' }
              : { kind: 'known', value: declaration.maxInputImages }
        },
        // The legacy schema explicitly defines omitted requirePrompt as true.
        prompt: declaration.requirePrompt === false ? 'optional' : 'required'
      }
    }
  }
}
