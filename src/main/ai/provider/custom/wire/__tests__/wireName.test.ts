import { wireName } from '@cherrystudio/provider-registry'
import type { CanonicalParamKey } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

/**
 * The durable spec of `wireName(key)`: it reproduces EVERY canonical→wire rename
 * the pipeline uses — both the flat WireProfile `forward` fields and the params
 * the aihubmix model formerly renamed via `AIHUBMIX_SNAKE_CASE_KEYS`. Nine are
 * plain camelCase→snake_case; the two irregulars (`imageResolution`/
 * `addWatermark`) come from the catalog `wire` override. If this stays green, the
 * scattered renames stay deleted and the name has exactly one source.
 *
 * (Integration — that each provider's body uses these names — is proven by the
 * `*.boundary.test.ts` snapshots.)
 */
const EXPECTED_WIRE: Record<string, string> = {
  // WireProfile `forward` fields (diffusion / openai / dashscope / aihubmix / dmxapi)
  negativePrompt: 'negative_prompt',
  seed: 'seed',
  numInferenceSteps: 'num_inference_steps',
  guidanceScale: 'guidance_scale',
  promptEnhancement: 'prompt_enhancement',
  quality: 'quality',
  background: 'background',
  moderation: 'moderation',
  style: 'style',
  // Formerly AIHUBMIX_SNAKE_CASE_KEYS (canonical entries) + doubao body fields
  safetyTolerance: 'safety_tolerance',
  personGeneration: 'person_generation',
  magicPromptOption: 'magic_prompt_option',
  styleType: 'style_type',
  renderingSpeed: 'rendering_speed',
  imageResolution: 'size',
  addWatermark: 'watermark',
  promptExtend: 'prompt_extend',
  thinkingMode: 'thinking_mode',
  sequentialImageGeneration: 'sequential_image_generation'
}

describe('wireName reproduces every canonical→wire rename', () => {
  it.each(Object.entries(EXPECTED_WIRE))('%s → %s', (key, expected) => {
    expect(wireName(key as CanonicalParamKey)).toBe(expected)
  })
})
