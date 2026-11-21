import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileProcessorOverrides } from '@shared/data/preference/preferenceTypes'

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

describe('resetProcessorOptions (#20286)', () => {
  it('drops capability and language overrides while keeping API keys', async () => {
    overridesMock.value = {
      paddleocr: {
        apiKeys: ['paddle-key'],
        capabilities: {
          image_to_text: {
            apiHost: 'https://ocr.example.com',
            modelId: 'PP-OCRv5'
          }
        }
      },
      tesseract: {
        options: { langs: ['eng', 'chi_sim'] }
      }
    }

    const { result } = renderHook(() => useFileProcessingPreferences())

    await result.current.resetProcessorOptions('paddleocr')

    expect(setOverridesMock).toHaveBeenCalledWith({
      paddleocr: { apiKeys: ['paddle-key'] },
      tesseract: {
        options: { langs: ['eng', 'chi_sim'] }
      }
    })
  })

  it('removes the override entry entirely when only options were set', async () => {
    overridesMock.value = {
      tesseract: {
        options: { langs: ['eng'] }
      }
    }

    const { result } = renderHook(() => useFileProcessingPreferences())

    await result.current.resetProcessorOptions('tesseract')

    expect(setOverridesMock).toHaveBeenCalledWith({})
  })

  it('does nothing for a processor without overrides', async () => {
    overridesMock.value = {}

    const { result } = renderHook(() => useFileProcessingPreferences())

    await result.current.resetProcessorOptions('mistral')

    expect(setOverridesMock).not.toHaveBeenCalled()
  })
})

describe('hasProcessorOptions (#20286)', () => {
  it('is true when capability fields or language options are overridden', () => {
    overridesMock.value = {
      paddleocr: { capabilities: { image_to_text: { modelId: 'PP-OCRv5' } } },
      tesseract: { options: { langs: ['eng'] } },
      mistral: { apiKeys: ['key-only'] }
    }

    const { result } = renderHook(() => useFileProcessingPreferences())

    expect(result.current.hasProcessorOptions('paddleocr')).toBe(true)
    expect(result.current.hasProcessorOptions('tesseract')).toBe(true)
    expect(result.current.hasProcessorOptions('mistral')).toBe(false)
    expect(result.current.hasProcessorOptions('system')).toBe(false)
  })
})
