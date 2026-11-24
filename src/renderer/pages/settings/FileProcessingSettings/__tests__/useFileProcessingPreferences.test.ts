import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { preferenceService } from '@data/PreferenceService'
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

beforeEach(() => {
  vi.mocked(preferenceService.getAuthoritative).mockImplementation(async () => overridesMock.value)
})

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
  it('propagates failed main-process resets without writing a captured map', async () => {
    vi.mocked(preferenceService.resetFileProcessorOptions).mockRejectedValueOnce(new Error('reset failed'))
    const { result } = renderHook(() => useFileProcessingPreferences())
    await expect(result.current.resetProcessorOptions('doc2x')).rejects.toThrow('reset failed')
    expect(setOverridesMock).not.toHaveBeenCalled()
  })
})

describe('hasProcessorOptions (#20286)', () => {
  it('does not offer reset for only retained credentials and their host', () => {
    overridesMock.value = { doc2x: { apiKeys: ['key'], capabilities: { document_to_markdown: { apiHost: '' } } } }
    const { result } = renderHook(() => useFileProcessingPreferences())
    expect(result.current.hasProcessorOptions('doc2x')).toBe(false)
  })

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
