import { describe, expect, it } from 'vitest'

import { buildImageProviderOptions, splitParamValues } from '../../../../utils/imageOptions'
import { buildImageRequest, buildVendorProviderOptions } from '../buildImageRequest'
import { DEFAULT_DIFFUSION_REGISTRATION, DIFFUSION_WIRE_PROFILE, WIRE_REGISTRY } from '../wireProfile'

// The engine's diffusion delivery must equal what buildImageProviderOptions
// produces today (the diffusion emitter), so the wire stays byte-identical. The
// oracle is computed from the REAL mapper — not a hand-written bag — to lock
// equivalence. `cfg` rides via passthrough (vendor bag), not the profile.
function oracleDiffusion(providerId: string, paramValues: Record<string, unknown>): Record<string, unknown> {
  const { structured, vendorBag } = splitParamValues(paramValues)
  const opts = buildImageProviderOptions(providerId, {
    ...structured,
    providerOptions: { [providerId]: vendorBag as Record<string, unknown> }
  })
  return (opts[providerId] ?? {}) as Record<string, unknown>
}

function engineDiffusion(providerId: string, paramValues: Record<string, unknown>): Record<string, unknown> {
  const { vendorBag } = splitParamValues(paramValues)
  const opts = buildVendorProviderOptions(providerId, paramValues, DEFAULT_DIFFUSION_REGISTRATION, vendorBag)
  return (opts[providerId] ?? {}) as Record<string, unknown>
}

describe('buildVendorProviderOptions — diffusion family (passthrough)', () => {
  it('reproduces the buildImageProviderOptions silicon bag byte-identically', () => {
    const paramValues = {
      numImages: 2,
      size: '1024x1024',
      seed: 42,
      negativePrompt: 'low quality',
      numInferenceSteps: 25,
      guidanceScale: 4.5,
      cfg: 7.5 // vendor-bag field → forwarded by passthrough, not the profile
    }
    const body = engineDiffusion('silicon', paramValues)
    expect(body).toEqual(oracleDiffusion('silicon', paramValues))
    expect(body).toHaveProperty('cfg', 7.5)
    // native params (n/size) are not in the vendor body
    expect(body).not.toHaveProperty('n')
    expect(body).not.toHaveProperty('size')
  })

  it("drops 'auto'/blank and passes cfg through (matches the legacy compact()/jsonBag merge)", () => {
    const paramValues = { quality: 'auto', negativePrompt: '', cfg: 7.5, promptEnhancement: true }
    expect(engineDiffusion('silicon', paramValues)).toEqual(oracleDiffusion('silicon', paramValues))
  })

  it('serves an unlisted provider as the catch-all (== legacy diffusion fallback)', () => {
    const paramValues = { seed: 9, numInferenceSteps: 30, addWatermark: true, cfg: 3 }
    expect(engineDiffusion('some-unlisted-provider', paramValues)).toEqual(
      oracleDiffusion('some-unlisted-provider', paramValues)
    )
  })

  it('matches the empty case', () => {
    expect(buildVendorProviderOptions('silicon', {}, DEFAULT_DIFFUSION_REGISTRATION, {})).toEqual({})
  })

  it('maps only the profile fields when passthrough is off', () => {
    const paramValues = { negativePrompt: 'x', seed: 1, cfg: 7.5 }
    // raw engine body (no passthrough): cfg is dropped, only profile fields map
    expect(buildImageRequest(paramValues, DIFFUSION_WIRE_PROFILE)).toEqual({ negative_prompt: 'x', seed: 1 })
  })
})

// The OpenAI image family (openai/openai-chat/azure/azure-responses/huggingface/
// cherryin/newapi) goes through the dual-keyed delivery adapter. The oracle is the
// EXACT legacy AiService branch: buildImageProviderOptions over the split params,
// vendor bag under providerOptions[id] (which the openaiFamily emitter ignores —
// reproduced here so the equivalence is provably the whole legacy behavior).
function oracleOpenAIFamily(
  providerId: string,
  paramValues: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  const { structured, vendorBag } = splitParamValues(paramValues)
  const providerOptions = Object.keys(vendorBag).length ? { [providerId]: vendorBag } : undefined
  return buildImageProviderOptions(providerId, { ...structured, providerOptions }) as Record<
    string,
    Record<string, unknown>
  >
}

describe('buildVendorProviderOptions — OpenAI image family (dual-keyed)', () => {
  const OPENAI_FAMILY = ['openai', 'openai-chat', 'azure', 'azure-responses', 'huggingface', 'cherryin', 'newapi']

  it.each(OPENAI_FAMILY)('reproduces the buildImageProviderOptions dual-key bag for %s', (providerId) => {
    const paramValues = {
      numImages: 2,
      size: '1024x1024',
      seed: 7, // OpenAI family drops seed from the body — must not appear
      quality: 'high',
      background: 'transparent',
      moderation: 'low',
      style: 'vivid'
    }
    const { vendorBag } = splitParamValues(paramValues)
    const result = buildVendorProviderOptions(providerId, paramValues, WIRE_REGISTRY[providerId], vendorBag)
    expect(result).toEqual(oracleOpenAIFamily(providerId, paramValues))
    // dual-keyed under `openai` and the provider id, with seed/native params absent
    expect(result).toEqual({
      openai: { quality: 'high', background: 'transparent', moderation: 'low', style: 'vivid' },
      [providerId]: { quality: 'high', background: 'transparent', moderation: 'low', style: 'vivid' }
    })
  })

  it("drops 'auto'/blank and returns {} when nothing maps", () => {
    const paramValues = { quality: 'auto', background: '', numInferenceSteps: 20, cfg: 7.5 }
    const { vendorBag } = splitParamValues(paramValues)
    expect(buildVendorProviderOptions('openai', paramValues, WIRE_REGISTRY.openai, vendorBag)).toEqual(
      oracleOpenAIFamily('openai', paramValues)
    )
    expect(buildVendorProviderOptions('openai', paramValues, WIRE_REGISTRY.openai, vendorBag)).toEqual({})
  })
})

// The Google native image family (google / google-vertex) builds a nested
// `imageConfig` block from aspectRatio + size via the `contribute` escape hatch,
// plus a lowercased flat `personGeneration`. Oracle = the legacy `google` emitter
// through buildImageProviderOptions over the split params.
function oracleGoogle(paramValues: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const { structured } = splitParamValues(paramValues)
  return buildImageProviderOptions('google', { ...structured }) as Record<string, Record<string, unknown>>
}

function engineGoogle(providerId: string, paramValues: Record<string, unknown>) {
  const { vendorBag } = splitParamValues(paramValues)
  return buildVendorProviderOptions(providerId, paramValues, WIRE_REGISTRY[providerId], vendorBag)
}

describe('buildVendorProviderOptions — Google native image family (contribute / nested imageConfig)', () => {
  const cases: Array<[string, Record<string, unknown>, Record<string, Record<string, unknown>>]> = [
    [
      'personGeneration + imageSize',
      { personGeneration: 'allow_adult', size: '1024x1024', numImages: 1 },
      { google: { imageConfig: { imageSize: '1024x1024' }, personGeneration: 'allow_adult' } }
    ],
    [
      'normalized aspectRatio + imageSize into imageConfig',
      { aspectRatio: 'ASPECT_16_9', size: '2048x2048', numImages: 1 },
      { google: { imageConfig: { aspectRatio: '16:9', imageSize: '2048x2048' } } }
    ],
    [
      'lowercases registry-uppercase personGeneration, no imageConfig when size unset',
      { personGeneration: 'ALLOW_ALL', numImages: 1 },
      { google: { personGeneration: 'allow_all' } }
    ]
  ]

  it.each(cases)('reproduces the google emitter: %s', (_label, paramValues, expected) => {
    const result = engineGoogle('google', paramValues)
    expect(result).toEqual(oracleGoogle(paramValues))
    expect(result).toEqual(expected)
  })

  it('drops an invalid aspectRatio so no empty imageConfig survives (== legacy compact)', () => {
    const paramValues = { aspectRatio: 'weird', numImages: 1 }
    expect(engineGoogle('google', paramValues)).toEqual(oracleGoogle(paramValues))
    expect(engineGoogle('google', paramValues)).toEqual({})
  })

  it('google-vertex shares the same profile', () => {
    const paramValues = { aspectRatio: 'ASPECT_1_1', size: '1024x1024', numImages: 1 }
    expect(engineGoogle('google-vertex', paramValues)).toEqual({
      'google-vertex': { imageConfig: { aspectRatio: '1:1', imageSize: '1024x1024' } }
    })
  })
})
