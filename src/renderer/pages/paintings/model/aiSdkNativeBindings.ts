/**
 * Canonical param key → its renderer→IPC payload field name.
 *
 * Replaces the old `AI_SDK_NATIVE_KEYS` Set + `POSITIONAL_RENAME` map in
 * `canonicalGenerate`, and removes the `batchSize` / `imageSize` phantom
 * intermediate names (`numImages → n`, `size → size`). A canonical param that
 * appears here lands in `aiSdkParams` under its `option` name (a top-level IPC
 * field); anything else flows through the vendor bag (`providerOptions[id]`).
 *
 * Phase-1 scope (IPC unchanged): this carries the FULL set of params that
 * currently get a top-level IPC field. Only the first four are genuine AI SDK
 * `ImageModelV3CallOptions` (`n`/`size`/`seed`/`aspectRatio`); the rest are
 * legacy top-level IPC fields (diffusion / OpenAI-image knobs) that migrate
 * into per-provider WireProfiles when the IPC payload is collapsed (Phase 4) —
 * at which point this table narrows to those four.
 *
 * `inputImages` is intentionally absent: it is sourced from
 * `painting.inputFiles` (not from `params`) and set on `aiSdkParams` directly.
 */
import type { CanonicalParamKey } from '@shared/data/types/model'

interface NativeBinding {
  /** The renderer→IPC payload field name this canonical param maps to. */
  readonly option: string
}

export const AI_SDK_NATIVE_BINDINGS = {
  // Genuine AI SDK ImageModelV3CallOptions:
  numImages: { option: 'n' },
  size: { option: 'size' },
  seed: { option: 'seed' },
  aspectRatio: { option: 'aspectRatio' },
  // Legacy top-level IPC fields → WireProfile body params in Phase 4:
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

/** The IPC field name a canonical `key` maps to, or `undefined` for vendor-bag params. */
export function nativeOptionFor(key: string): string | undefined {
  return (AI_SDK_NATIVE_BINDINGS as Record<string, NativeBinding | undefined>)[key]?.option
}
