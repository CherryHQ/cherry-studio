import { wireName } from '@cherrystudio/provider-registry'
import type { CanonicalParamKey } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import type { WireProfile } from '../wireProfile'
import {
  AIHUBMIX_WIRE_PROFILE,
  DASHSCOPE_WIRE_PROFILE,
  DIFFUSION_WIRE_PROFILE,
  DMXAPI_WIRE_PROFILE,
  OPENAI_WIRE_PROFILE
} from '../wireProfile'

/**
 * Falsification test for the Stage-0 hypothesis: the central `wireName(key)`
 * (catalog `wire` override, else camelCase→snake_case) reproduces EVERY existing
 * canonical→wire rename — both the flat WireProfile `.to` rows and the aihubmix
 * `AIHUBMIX_SNAKE_CASE_KEYS` map. If this stays green, Stage 1/2 can delete those
 * scattered renames and derive the name from `wireName` alone.
 */

const FLAT_PROFILES: Array<readonly [string, WireProfile]> = [
  ['diffusion', DIFFUSION_WIRE_PROFILE],
  ['openai', OPENAI_WIRE_PROFILE],
  ['aihubmix', AIHUBMIX_WIRE_PROFILE],
  ['dashscope', DASHSCOPE_WIRE_PROFILE],
  ['dmxapi', DMXAPI_WIRE_PROFILE]
]

describe('wireName reproduces the live WireProfile .to rows', () => {
  it.each(FLAT_PROFILES)('%s profile: every field.to === wireName(key)', (_name, profile) => {
    for (const [key, rule] of Object.entries(profile.fields)) {
      if (rule?.to === undefined) continue // contribute-only rules carry no flat name
      expect(rule.to).toBe(wireName(key as CanonicalParamKey))
    }
  })
})

// The aihubmix model's AIHUBMIX_SNAKE_CASE_KEYS map (a module-local const, deleted
// in Stage 2), restricted to its CANONICAL entries — the contract `wireName` must
// reproduce. Nine are plain snake_case; the 2 irregulars
// (`imageResolution`/`addWatermark`) come from the catalog `wire` override.
// NOTE: the map also lists `colorPalette`/`referImage`, which are NOT in
// `CANONICAL_PARAM_KEY` — they can never reach the bag via `paramValues`, so
// they're dead entries (dropped, not subsumed, when the map is deleted).
const AIHUBMIX_SNAKE_MAP: Record<string, string> = {
  safetyTolerance: 'safety_tolerance',
  personGeneration: 'person_generation',
  negativePrompt: 'negative_prompt',
  magicPromptOption: 'magic_prompt_option',
  styleType: 'style_type',
  renderingSpeed: 'rendering_speed',
  imageResolution: 'size',
  addWatermark: 'watermark',
  promptExtend: 'prompt_extend',
  thinkingMode: 'thinking_mode',
  // Doubao body field that rides through the same path.
  sequentialImageGeneration: 'sequential_image_generation'
}

describe('wireName reproduces the aihubmix snake-map (+ doubao body) renames', () => {
  it.each(Object.entries(AIHUBMIX_SNAKE_MAP))('%s → %s', (key, expected) => {
    expect(wireName(key as CanonicalParamKey)).toBe(expected)
  })
})
