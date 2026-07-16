import { describe, expect, it } from 'vitest'

import { parseOrEntry, parseOrImageGeneration } from '../upstream'

describe('parseOrEntry', () => {
  it('parses dedicated OpenRouter image-model entries with parameter descriptors', () => {
    expect(
      parseOrEntry({
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

  it('keeps an empty generate mode for image models that advertise no optional parameters', () => {
    expect(parseOrImageGeneration({ supported_parameters: {} })).toEqual({
      modes: { generate: { supports: {} } }
    })
  })
})
