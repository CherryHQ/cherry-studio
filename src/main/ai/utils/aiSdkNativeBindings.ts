/**
 * Canonical param key → its structured request field name.
 *
 * After the `ai.generate_image` payload collapse, the renderer sends one
 * canonical `paramValues` bag; main uses this table (via {@link splitParamValues}
 * in `imageOptions.ts`) to partition it into the structured fields
 * `buildImageProviderOptions` / `imageParams` consume vs the leftover vendor bag
 * (`providerOptions[providerId]`).
 *
 * Only `numImages → n` is a rename; the rest are identity (the
 * `AiImageRequest` / `ImageOptionParams` field happens to equal the canonical
 * name). The first four are genuine AI SDK `ImageModelV3CallOptions`; the rest
 * are diffusion / OpenAI-image knobs that migrate into per-provider WireProfiles
 * in PR4+.
 */
import type { CanonicalParamKey } from '@shared/data/types/model'

interface NativeBinding {
  /** The structured field name (`AiImageRequest` / `ImageOptionParams` key). */
  readonly option: string
}

export const AI_SDK_NATIVE_BINDINGS = {
  // Genuine AI SDK ImageModelV3CallOptions:
  numImages: { option: 'n' },
  size: { option: 'size' },
  seed: { option: 'seed' },
  aspectRatio: { option: 'aspectRatio' },
  // Diffusion / OpenAI-image knobs → WireProfile body params in PR4+:
  negativePrompt: { option: 'negativePrompt' },
  numInferenceSteps: { option: 'numInferenceSteps' },
  guidanceScale: { option: 'guidanceScale' },
  promptEnhancement: { option: 'promptEnhancement' },
  personGeneration: { option: 'personGeneration' },
  quality: { option: 'quality' },
  background: { option: 'background' },
  moderation: { option: 'moderation' },
  style: { option: 'style' }
} as const satisfies Partial<Record<CanonicalParamKey, NativeBinding>>

/** The structured field name a canonical `key` maps to, or `undefined` for vendor-bag params. */
export function nativeOptionFor(key: string): string | undefined {
  return (AI_SDK_NATIVE_BINDINGS as Record<string, NativeBinding | undefined>)[key]?.option
}
