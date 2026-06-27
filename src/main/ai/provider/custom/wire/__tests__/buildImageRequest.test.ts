import { describe, expect, it } from 'vitest'

import { buildImageProviderOptions, splitParamValues } from '../../../../utils/imageOptions'
import { buildImageRequest, buildVendorProviderOptions } from '../buildImageRequest'
import { DIFFUSION_WIRE_PROFILE, WIRE_REGISTRY } from '../wireProfile'

// The engine's silicon body must equal what buildImageProviderOptions produces
// today (the diffusion emitter), so the wire stays byte-identical. The oracle is
// computed from the REAL mapper — not a hand-written bag — to lock equivalence.
function oracleSiliconBag(paramValues: Record<string, unknown>): Record<string, unknown> {
  const { structured, vendorBag } = splitParamValues(paramValues)
  const opts = buildImageProviderOptions('silicon', {
    ...structured,
    providerOptions: { silicon: vendorBag as Record<string, unknown> }
  })
  return (opts.silicon ?? {}) as Record<string, unknown>
}

describe('buildImageRequest — silicon', () => {
  it('reproduces the buildImageProviderOptions silicon bag byte-identically', () => {
    const paramValues = {
      numImages: 2,
      size: '1024x1024',
      seed: 42,
      negativePrompt: 'low quality',
      numInferenceSteps: 25,
      guidanceScale: 4.5,
      cfg: 7.5
    }
    const body = buildImageRequest(paramValues, DIFFUSION_WIRE_PROFILE)
    expect(body).toEqual(oracleSiliconBag(paramValues))
    // native params (n/size) are not in the vendor body
    expect(body).not.toHaveProperty('n')
    expect(body).not.toHaveProperty('size')
  })

  it("drops 'auto'/blank and passes cfg through (matches compact())", () => {
    const paramValues = { quality: 'auto', negativePrompt: '', cfg: 7.5, promptEnhancement: true }
    expect(buildImageRequest(paramValues, DIFFUSION_WIRE_PROFILE)).toEqual(oracleSiliconBag(paramValues))
  })

  it('matches the empty case', () => {
    expect(buildImageRequest({}, DIFFUSION_WIRE_PROFILE)).toEqual(oracleSiliconBag({}))
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
    const result = buildVendorProviderOptions(providerId, paramValues, WIRE_REGISTRY[providerId])
    expect(result).toEqual(oracleOpenAIFamily(providerId, paramValues))
    // dual-keyed under `openai` and the provider id, with seed/native params absent
    expect(result).toEqual({
      openai: { quality: 'high', background: 'transparent', moderation: 'low', style: 'vivid' },
      [providerId]: { quality: 'high', background: 'transparent', moderation: 'low', style: 'vivid' }
    })
  })

  it("drops 'auto'/blank and returns {} when nothing maps", () => {
    const paramValues = { quality: 'auto', background: '', numInferenceSteps: 20, cfg: 7.5 }
    expect(buildVendorProviderOptions('openai', paramValues, WIRE_REGISTRY.openai)).toEqual(
      oracleOpenAIFamily('openai', paramValues)
    )
    expect(buildVendorProviderOptions('openai', paramValues, WIRE_REGISTRY.openai)).toEqual({})
  })
})
