import type { ImageGenerationMode, ImageGenerationSupport, ImageModeDef, ModelConfig } from '../schemas/model'
import type { ProviderModelOverride } from '../schemas/provider-models'

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
