import { describe, expect, it } from 'vitest'

import { mergeMeta, parseMdEntry, parseOpenRouterReasoning, parseOrEntry, parseOrImageGeneration } from '../upstream'

describe('upstream field decoding', () => {
  it('keeps the existing four upstream modalities and omits unknown vocabularies', () => {
    expect(
      parseMdEntry({
        modalities: { input: ['text', 'vector', 'image', 'future'], output: ['audio', 'video', 'vector'] }
      })
    ).toMatchObject({
      inputModalities: ['text', 'image'],
      outputModalities: ['audio', 'video']
    })
    expect(
      parseOrEntry({ architecture: { input_modalities: ['vector', 'text'], output_modalities: ['image', 'future'] } })
    ).toMatchObject({
      inputModalities: ['text'],
      outputModalities: ['image']
    })
    expect(parseMdEntry({ modalities: { input: [7] } })).toBeNull()
  })

  it('retains required zero prices and omits only missing cache prices', () => {
    const result = parseMdEntry({ cost: { input: 0, output: 0, cache_read: 0 } })
    expect(result?.pricing).toEqual({
      input: { currency: 'USD', perMillionTokens: 0 },
      output: { currency: 'USD', perMillionTokens: 0 },
      cacheRead: { currency: 'USD', perMillionTokens: 0 }
    })
    expect(result?.pricing).not.toHaveProperty('cacheWrite')
    expect(parseMdEntry({ cost: { input: 1 } })).not.toHaveProperty('pricing')
  })

  it('ignores an unknown default effort while retaining the advertised valid effort controls', () => {
    const support = parseOpenRouterReasoning({
      reasoning: { supported_efforts: ['low', 'future'], default_effort: 'future', mandatory: true }
    })
    expect(support?.controls).toEqual([{ kind: 'effort', values: ['low'] }])
  })
})

describe('mergeMeta', () => {
  it('orders known capabilities while preserving other valid capabilities in their original tail order', () => {
    expect(
      mergeMeta(
        { capabilities: ['embedding', 'reasoning'] },
        { capabilities: ['computer-use', 'function-call', 'embedding'] }
      ).capabilities
    ).toEqual(['function-call', 'reasoning', 'embedding', 'computer-use'])
  })

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

describe('parseOrEntry', () => {
  it('parses dedicated OpenRouter image-model entries with parameter descriptors', () => {
    expect(
      parseOrEntry({
        name: 'Sourceful: Riverflow V2.5 Fast',
        architecture: {
          input_modalities: ['text', 'image'],
          output_modalities: ['image']
        },
        supported_parameters: {
          resolution: { type: 'enum', values: ['1K', '2K', '4K'] },
          seed: { type: 'boolean' }
        }
      })
    ).toEqual({
      name: 'Sourceful: Riverflow V2.5 Fast',
      capabilities: ['image-recognition', 'image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image']
    })
  })
})

describe('parseOrImageGeneration', () => {
  it('maps OpenRouter descriptors to canonical controls and enables edit for input references', () => {
    expect(
      parseOrImageGeneration({
        supported_parameters: {
          resolution: { type: 'enum', values: ['1K', '2K'] },
          aspect_ratio: { type: 'enum', values: ['1:1', '16:9'] },
          n: { type: 'range', min: 1, max: 10 },
          output_compression: { type: 'range', min: 0, max: 100 },
          output_format: { type: 'enum', values: ['png', 'webp'] },
          seed: { type: 'boolean' },
          input_references: { type: 'range', min: 0, max: 16 }
        }
      })
    ).toEqual({
      modes: {
        generate: {
          supports: {
            aspectRatio: { type: 'enum', options: ['1:1', '16:9'] },
            numImages: { type: 'range', min: 1, max: 10, step: 1 },
            outputCompression: { type: 'range', min: 0, max: 100, step: 1 },
            outputFormat: { type: 'enum', options: ['png', 'webp'] },
            resolution: { type: 'enum', options: ['1K', '2K'] },
            seed: { type: 'text' }
          }
        },
        edit: {
          maxInputImages: 16,
          supports: {
            aspectRatio: { type: 'enum', options: ['1:1', '16:9'] },
            numImages: { type: 'range', min: 1, max: 10, step: 1 },
            outputCompression: { type: 'range', min: 0, max: 100, step: 1 },
            outputFormat: { type: 'enum', options: ['png', 'webp'] },
            resolution: { type: 'enum', options: ['1K', '2K'] },
            seed: { type: 'text' }
          }
        }
      }
    })
  })

  it('preserves each model input-reference maximum', () => {
    expect(
      parseOrImageGeneration({
        supported_parameters: {
          input_references: { type: 'range', min: 0, max: 1 }
        }
      })
    ).toEqual({
      modes: {
        generate: { supports: {} },
        edit: { supports: {}, maxInputImages: 1 }
      }
    })
  })

  it('does not advertise edit when input references are unavailable', () => {
    expect(
      parseOrImageGeneration({
        supported_parameters: {
          quality: { type: 'enum', values: ['auto', 'high'] },
          input_references: { type: 'range', min: 0, max: 0 }
        }
      })
    ).toEqual({
      modes: { generate: { supports: { quality: { type: 'enum', options: ['auto', 'high'] } } } }
    })
  })

  it('drops orphaned output compression that OpenRouter would reject without jpeg/webp format', () => {
    expect(
      parseOrImageGeneration({
        supported_parameters: {
          quality: { type: 'enum', values: ['auto', 'high'] },
          output_compression: { type: 'range', min: 0, max: 100 }
        }
      })
    ).toEqual({
      modes: { generate: { supports: { quality: { type: 'enum', options: ['auto', 'high'] } } } }
    })
  })

  it('removes transparent background when a model only supports JPEG output', () => {
    expect(
      parseOrImageGeneration({
        supported_parameters: {
          background: { type: 'enum', values: ['auto', 'transparent', 'opaque'] },
          output_format: { type: 'enum', values: ['jpeg'] },
          input_references: { type: 'range', min: 0, max: 4 }
        }
      })
    ).toEqual({
      modes: {
        generate: {
          supports: {
            background: { type: 'enum', options: ['auto', 'opaque'] },
            outputFormat: { type: 'enum', options: ['jpeg'] }
          }
        },
        edit: {
          maxInputImages: 4,
          supports: {
            background: { type: 'enum', options: ['auto', 'opaque'] },
            outputFormat: { type: 'enum', options: ['jpeg'] }
          }
        }
      }
    })
  })

  it('keeps an empty generate mode for image models that advertise no optional parameters', () => {
    expect(parseOrImageGeneration({ supported_parameters: {} })).toEqual({
      modes: { generate: { supports: {} } }
    })
  })
})
