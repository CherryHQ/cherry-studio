/**
 * Canonical param key → its structured request field (+ optional wire
 * normalization). After the `ai.generate_image` payload collapse, the renderer
 * sends one canonical `paramValues` bag; `splitParamValues` (in `imageOptions.ts`)
 * uses this table to partition it into the structured fields the AI SDK
 * `imageParams` consume vs the leftover vendor bag the WireProfile engine
 * forwards, applying each binding's `map` once.
 *
 * `numImages → n` is the only rename; `aspectRatio` carries a `map`
 * (`ASPECT_X_Y → X:Y`, the AI SDK `ImageModelV3CallOptions` shape) so the
 * normalization happens once here instead of scattered across `AiService` + the
 * emitters. The rest are identity. The first four are genuine AI SDK options;
 * the others are diffusion / OpenAI-image knobs that migrate into per-provider
 * WireProfiles in PR4+.
 */
import type { CanonicalParamKey } from '@shared/data/types/model'

interface NativeBinding {
  /** The structured field name (the `ParamValues` key, `numImages → n`). */
  readonly option: string
  /** Optional wire normalization applied once during the split. */
  readonly map?: (value: unknown) => unknown
}

/**
 * Normalize the painting form's `ASPECT_X_Y` enum (or already-normalized `X:Y`)
 * into the `${number}:${number}` shape the AI SDK image option + Google/Imagen
 * accept. Returns `undefined` for blank / mismatched values so the field is
 * omitted. Idempotent (`X:Y → X:Y`), so emitters may re-apply it safely.
 */
export function normalizeAspectRatio(value: string | undefined): string | undefined {
  if (!value) return undefined
  const stripped = value.replace(/^ASPECT_/i, '').replace('_', ':')
  return /^\d+:\d+$/.test(stripped) ? stripped : undefined
}

export const AI_SDK_NATIVE_BINDINGS = {
  // Genuine AI SDK ImageModelV3CallOptions:
  numImages: { option: 'n' },
  size: { option: 'size' },
  seed: { option: 'seed' },
  aspectRatio: {
    option: 'aspectRatio',
    map: (v: unknown) => normalizeAspectRatio(typeof v === 'string' ? v : undefined)
  },
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

/** The binding entry for a canonical `key`, or `undefined` for vendor-bag params. */
export function nativeBindingFor(key: string): NativeBinding | undefined {
  return (AI_SDK_NATIVE_BINDINGS as Record<string, NativeBinding | undefined>)[key]
}
