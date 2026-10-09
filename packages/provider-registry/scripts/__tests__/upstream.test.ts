import { describe, expect, it } from 'vitest'

import google from '../../src/creators/google'
import openai from '../../src/creators/openai'
import { buildImageRequestParamsSchema } from '../../src/utils/buildImageRequestParamsSchema'
import { resolveImageCapability, resolveImageGenerationSupport } from '../../src/utils/imageCapabilities'
import { mergeMeta, parseOrImageGeneration } from '../upstream'

describe('mergeMeta', () => {
  it('does not widen an earlier reasoning vocabulary with later source values', () => {
    const result = mergeMeta(
      {
        reasoning: {
          supportedEfforts: ['none', 'low', 'high', 'max'],
          controls: [
            { kind: 'effort', values: ['none', 'low', 'high', 'max'], default: 'low' },
            { kind: 'budget', min: 1_024, max: 32_768, default: 8_192 }
          ]
        }
      },
      {
        reasoning: {
          supportedEfforts: ['xhigh', 'high'],
          controls: [
            { kind: 'effort', values: ['xhigh', 'high'], default: 'xhigh' },
            { kind: 'budget', min: 1, max: 100_000, default: 1 }
          ]
        }
      }
    )

    expect(result.reasoning).toEqual({
      supportedEfforts: ['none', 'low', 'high', 'max'],
      controls: [
        { kind: 'effort', values: ['none', 'low', 'high', 'max'], default: 'low' },
        { kind: 'budget', min: 1_024, max: 32_768, default: 8_192 }
      ]
    })
  })

  it('fills reasoning control kinds missing from the earlier source', () => {
    const result = mergeMeta(
      { reasoning: { controls: [{ kind: 'effort', values: ['low', 'high'] }] } },
      { reasoning: { controls: [{ kind: 'budget', min: 1_024, max: 65_536 }] } }
    )

    expect(result.reasoning?.controls).toEqual([
      { kind: 'effort', values: ['low', 'high'] },
      { kind: 'budget', min: 1_024, max: 65_536 }
    ])
  })
})

describe('OpenRouter discovery overrides', () => {
  // https://openrouter.ai/api/v1/images/models — supported_parameters snapshots retrieved 2026-10-08.
  // https://openrouter.ai/docs/guides/overview/multimodal/image-generation — resolution is a top-level /images field.
  it.each([
    ['gemini-2-5-flash-image', []],
    ['gemini-3-1-flash-image', ['512', '1K', '2K', '4K']],
    ['gemini-3-1-flash-image-preview', ['512', '1K', '2K', '4K']],
    ['gemini-3-pro-image', ['1K', '2K', '4K']],
    ['gemini-3-pro-image-preview', ['1K', '2K', '4K']]
  ] as const)('does not inherit native imageResolution for %s', (modelId, values) => {
    const base = google.models?.find((model) => model.id === modelId)
    if (!base?.imageGeneration) throw new Error(`Missing creator fixture ${modelId}`)
    const imageGeneration = parseOrImageGeneration(
      { supported_parameters: values.length ? { resolution: { type: 'enum', values } } : {} },
      base.imageGeneration
    )
    if (!imageGeneration) throw new Error('Image discovery must produce an override')
    const support = resolveImageGenerationSupport(base, { imageGeneration })
    for (const hasImages of [false, true]) {
      const result = resolveImageCapability(support, 'generate', hasImages)
      if (result.kind !== 'supported') throw new Error('Missing generated capability')
      const schema = buildImageRequestParamsSchema(result.capability)
      expect(schema.safeParse({ imageResolution: '2K' }).success).toBe(false)
      for (const resolution of ['auto', '512', '1K', '2K', '4K']) {
        expect(schema.safeParse({ resolution }).success).toBe(values.some((value) => value === resolution))
      }
    }
  })

  // https://openrouter.ai/docs/guides/overview/multimodal/image-generation — retrieved 2026-10-08.
  // https://openrouter.ai/api/v1/images/models/openai/gpt-image-1/endpoints — retrieved 2026-10-08.
  it('does not interpret omission from standard discovery as removal of size or vendor options', () => {
    const base = openai.models?.find((model) => model.id === 'gpt-image-1')
    if (!base?.imageGeneration) throw new Error('Missing GPT creator fixture')
    const imageGeneration = parseOrImageGeneration(
      { supported_parameters: { quality: { type: 'enum', values: ['auto', 'low', 'medium', 'high'] } } },
      base.imageGeneration
    )
    if (!imageGeneration) throw new Error('Image discovery must produce an override')
    const support = resolveImageGenerationSupport(base, { imageGeneration })
    if (!support) throw new Error('Missing GPT capability')
    expect(buildImageRequestParamsSchema(support).safeParse({ size: '1024x1024', moderation: 'low' }).success).toBe(
      true
    )
  })

  // https://openrouter.ai/docs/guides/overview/multimodal/image-generation — retrieved 2026-10-08.
  it('requires a usable output format before advertising lossy compression or transparent output', () => {
    const orphan = parseOrImageGeneration(
      { supported_parameters: { output_compression: { type: 'range', min: 0, max: 100 } } },
      undefined
    )
    expect(orphan?.supports).not.toHaveProperty('outputCompression')
    const jpeg = parseOrImageGeneration(
      {
        supported_parameters: {
          background: { type: 'enum', values: ['auto', 'transparent', 'opaque'] },
          output_format: { type: 'enum', values: ['jpeg'] },
          output_compression: { type: 'range', min: 0, max: 100 }
        }
      },
      undefined
    )
    const support = resolveImageGenerationSupport(null, jpeg ? { imageGeneration: jpeg } : null)
    if (!support) throw new Error('Missing standalone image capability')
    const schema = buildImageRequestParamsSchema(support)
    expect(schema.safeParse({ background: 'transparent', outputFormat: 'jpeg' }).success).toBe(false)
    expect(schema.safeParse({ background: 'opaque', outputFormat: 'jpeg', outputCompression: 50 }).success).toBe(true)
    expect(schema.safeParse({ outputCompression: 101 }).success).toBe(false)
  })
})
