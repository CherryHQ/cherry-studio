import type { FileProcessorOverrides } from '@shared/data/preference/preferenceTypes'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFileProcessingPreferences } from '../hooks/useFileProcessingPreferences'

const setPreferencesMock = vi.hoisted(() => vi.fn())
const setOverridesMock = vi.hoisted(() => vi.fn())
const preferencesMock = vi.hoisted(() => ({
  defaultDocumentProcessor: null as string | null,
  defaultImageProcessor: null as string | null
}))
const overridesMock = vi.hoisted(() => ({ value: {} as FileProcessorOverrides }))

vi.mock('@data/hooks/usePreference', () => ({
  useMultiplePreferences: () => [preferencesMock, setPreferencesMock],
  usePreference: () => [overridesMock.value, setOverridesMock]
}))

describe('useFileProcessingPreferences', () => {
  beforeEach(() => {
    preferencesMock.defaultDocumentProcessor = null
    preferencesMock.defaultImageProcessor = null
    overridesMock.value = {}
    setPreferencesMock.mockReset()
    setPreferencesMock.mockResolvedValue(undefined)
    setOverridesMock.mockReset()
    setOverridesMock.mockResolvedValue(undefined)
  })

  it('writes API keys by merging into the current overrides', async () => {
    overridesMock.value = {
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

    expect(setOverridesMock).toHaveBeenCalledWith({
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
    })
  })

  it('writes capability fields by preserving existing processor override fields', async () => {
    overridesMock.value = {
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

    expect(setOverridesMock).toHaveBeenCalledWith({
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
    })
  })

  it('writes language options from the current overrides', async () => {
    overridesMock.value = {
      tesseract: {
        apiKeys: ['unused-key']
      }
    }

    const { result } = renderHook(() => useFileProcessingPreferences())

    await result.current.setLanguageOptions('tesseract', ['eng', 'chi_sim'])

    expect(setOverridesMock).toHaveBeenCalledWith({
      tesseract: {
        apiKeys: ['unused-key'],
        options: {
          langs: ['eng', 'chi_sim']
        }
      }
    })
  })
})
