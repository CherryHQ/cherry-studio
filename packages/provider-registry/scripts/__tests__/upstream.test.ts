import { describe, expect, it } from 'vitest'

import { parseOrEntry } from '../upstream'

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
