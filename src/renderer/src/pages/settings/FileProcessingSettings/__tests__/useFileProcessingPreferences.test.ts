import type { FileProcessorOverrides } from '@shared/data/preference/preferenceTypes'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFileProcessingPreferences } from '../hooks/useFileProcessingPreferences'

const setPreferencesMock = vi.hoisted(() => vi.fn())
const preferencesMock = vi.hoisted(() => ({
  defaultDocumentProcessor: null as string | null,
  defaultImageProcessor: null as string | null,
  overrides: {} as FileProcessorOverrides
}))

vi.mock('@data/hooks/usePreference', () => ({
  useMultiplePreferences: () => [preferencesMock, setPreferencesMock]
}))

describe('useFileProcessingPreferences', () => {
  beforeEach(() => {
    preferencesMock.defaultDocumentProcessor = null
    preferencesMock.defaultImageProcessor = null
    preferencesMock.overrides = {}
    setPreferencesMock.mockReset()
    setPreferencesMock.mockResolvedValue(undefined)
  })

  it('writes API keys by merging into the current overrides', async () => {
    preferencesMock.overrides = {
      paddleocr: {
        capabilities: {
          document_to_markdown: {
            modelId: 'PP-StructureV3'
          }
        }
      }
    }

    const { result } = renderHook(() => useFileProcessingPreferences())

    await result.current.setApiKeys('mistral', ['mistral-key'])

    expect(setPreferencesMock).toHaveBeenCalledWith({
      overrides: {
        paddleocr: {
          capabilities: {
            document_to_markdown: {
              modelId: 'PP-StructureV3'
            }
          }
        },
        mistral: {
          apiKeys: ['mistral-key']
        }
      }
    })
  })

  it('writes capability fields by preserving existing processor override fields', async () => {
    preferencesMock.overrides = {
      paddleocr: {
        apiKeys: ['paddle-key'],
        capabilities: {
          image_to_text: {
            modelId: 'PP-OCRv5'
          }
        }
      }
    }

    const { result } = renderHook(() => useFileProcessingPreferences())

    await result.current.setCapabilityField('paddleocr', 'document_to_markdown', 'modelId', 'PP-StructureV3')

    expect(setPreferencesMock).toHaveBeenCalledWith({
      overrides: {
        paddleocr: {
          apiKeys: ['paddle-key'],
          capabilities: {
            image_to_text: {
              modelId: 'PP-OCRv5'
            },
            document_to_markdown: {
              modelId: 'PP-StructureV3'
            }
          }
        }
      }
    })
  })

  it('writes language options from the current overrides', async () => {
    preferencesMock.overrides = {
      tesseract: {
        apiKeys: ['unused-key']
      }
    }

    const { result } = renderHook(() => useFileProcessingPreferences())

    await result.current.setLanguageOptions('tesseract', ['eng', 'chi_sim'])

    expect(setPreferencesMock).toHaveBeenCalledWith({
      overrides: {
        tesseract: {
          apiKeys: ['unused-key'],
          options: {
            langs: ['eng', 'chi_sim']
          }
        }
      }
    })
  })
})
