import { describe, expect, it } from 'vitest'

import {
  updateProcessorApiKeys,
  updateProcessorCapabilityOverride,
  updateProcessorLanguageOptions
} from '../utils/fileProcessingPreferences'

describe('fileProcessingPreferences', () => {
  it('updates API keys without mutating other processor overrides', () => {
    const result = updateProcessorApiKeys(
      {
        mistral: {
          apiKeys: ['mistral-key']
        }
      },
      'paddleocr',
      [' paddle-key ']
    )

    expect(result).toEqual({
      mistral: {
        apiKeys: ['mistral-key']
      },
      paddleocr: {
        apiKeys: ['paddle-key']
      }
    })
  })

  it('updates only the selected capability override', () => {
    const result = updateProcessorCapabilityOverride(
      {
        paddleocr: {
          capabilities: {
            document_to_markdown: {
              apiHost: 'https://doc.example.com'
            }
          }
        }
      },
      'paddleocr',
      'image_to_text',
      'apiHost',
      ' https://image.example.com/ '
    )

    expect(result).toEqual({
      paddleocr: {
        capabilities: {
          document_to_markdown: {
            apiHost: 'https://doc.example.com'
          },
          image_to_text: {
            apiHost: 'https://image.example.com/'
          }
        }
      }
    })
  })

  it('removes an empty capability field while preserving populated sibling fields', () => {
    const result = updateProcessorCapabilityOverride(
      {
        paddleocr: {
          capabilities: {
            image_to_text: {
              apiHost: 'https://ocr.example.com',
              modelId: 'PP-OCRv5'
            }
          }
        }
      },
      'paddleocr',
      'image_to_text',
      'apiHost',
      ' '
    )

    expect(result).toEqual({
      paddleocr: {
        capabilities: {
          image_to_text: {
            modelId: 'PP-OCRv5'
          }
        }
      }
    })
  })

  it('removes empty capability overrides to keep preset defaults active', () => {
    const result = updateProcessorCapabilityOverride(
      {
        paddleocr: {
          capabilities: {
            image_to_text: {
              apiHost: 'https://ocr.example.com'
            }
          }
        }
      },
      'paddleocr',
      'image_to_text',
      'apiHost',
      ''
    )

    expect(result).toEqual({})
  })

  it('stores processor language options', () => {
    const result = updateProcessorLanguageOptions({}, 'tesseract', ['eng', 'chi_sim'])

    expect(result).toEqual({
      tesseract: {
        options: {
          langs: ['eng', 'chi_sim']
        }
      }
    })
  })

  it('merges processor options without dropping unrelated keys', () => {
    const result = updateProcessorLanguageOptions(
      {
        tesseract: {
          options: {
            apiVersion: '2026-03-23',
            langs: ['eng']
          }
        }
      },
      'tesseract',
      ['chi_sim']
    )

    expect(result).toEqual({
      tesseract: {
        options: {
          apiVersion: '2026-03-23',
          langs: ['chi_sim']
        }
      }
    })
  })

  it('removes empty language options to keep overrides as deltas', () => {
    const result = updateProcessorLanguageOptions(
      {
        tesseract: {
          options: {
            langs: ['eng']
          }
        }
      },
      'tesseract',
      []
    )

    expect(result).toEqual({})
  })
})
