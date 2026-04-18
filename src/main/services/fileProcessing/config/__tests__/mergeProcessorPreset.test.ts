import { PRESETS_FILE_PROCESSORS } from '@shared/data/presets/file-processing'
import { describe, expect, it } from 'vitest'

import { mergeProcessorPreset } from '../mergeProcessorPreset'

describe('mergeProcessorPreset', () => {
  it('returns preset capabilities unchanged when override is missing', () => {
    const preset = PRESETS_FILE_PROCESSORS.find((item) => item.id === 'tesseract')

    expect(preset).toBeDefined()
    expect(mergeProcessorPreset(preset!)).toEqual({
      id: 'tesseract',
      type: 'builtin',
      capabilities: [
        {
          feature: 'text_extraction',
          inputs: ['image'],
          output: 'text'
        }
      ],
      apiKeys: undefined,
      options: undefined
    })
  })

  it('merges processor-level apiKeys and options from override', () => {
    const preset = PRESETS_FILE_PROCESSORS.find((item) => item.id === 'doc2x')

    expect(preset).toBeDefined()
    expect(
      mergeProcessorPreset(preset!, {
        apiKeys: ['key-1', 'key-2'],
        options: {
          mode: 'fast'
        }
      })
    ).toEqual({
      id: 'doc2x',
      type: 'api',
      capabilities: [
        {
          feature: 'markdown_conversion',
          inputs: ['document'],
          output: 'markdown',
          apiHost: 'https://v2.doc2x.noedgeai.com',
          modelId: 'v3-2026'
        }
      ],
      apiKeys: ['key-1', 'key-2'],
      options: {
        mode: 'fast'
      }
    })
  })

  it('merges capability override only into the targeted feature', () => {
    const preset = PRESETS_FILE_PROCESSORS.find((item) => item.id === 'paddleocr')

    expect(preset).toBeDefined()

    const merged = mergeProcessorPreset(preset!, {
      capabilities: {
        markdown_conversion: {
          apiHost: 'https://custom.example.com',
          modelId: 'custom-model'
        }
      }
    })

    expect(merged.capabilities).toEqual([
      {
        feature: 'text_extraction',
        inputs: ['image'],
        output: 'text',
        apiHost: 'https://paddleocr.aistudio-app.com/',
        modelId: 'PaddleOCR-VL-1.5'
      },
      {
        feature: 'markdown_conversion',
        inputs: ['document'],
        output: 'markdown',
        apiHost: 'https://custom.example.com',
        modelId: 'custom-model'
      }
    ])
  })
})
