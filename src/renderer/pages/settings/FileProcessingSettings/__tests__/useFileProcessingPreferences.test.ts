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

  it('routes single-field edits through the main process instead of writing a captured map', async () => {
    overridesMock.value = { paddleocr: { apiKeys: ['paddle-key'] } }
    const { result } = renderHook(() => useFileProcessingPreferences())

    await result.current.setApiKeys('mistral', ['mistral-key'])
    await result.current.setCapabilityField('paddleocr', 'document_to_markdown', 'modelId', 'PP-StructureV3')
    await result.current.setLanguageOptions('tesseract', ['eng', 'chi_sim'])

    expect(preferenceService.editFileProcessorOption).toHaveBeenNthCalledWith(1, 'mistral', {
      type: 'apiKeys',
      apiKeys: ['mistral-key']
    })
    expect(preferenceService.editFileProcessorOption).toHaveBeenNthCalledWith(2, 'paddleocr', {
      type: 'capability',
      feature: 'document_to_markdown',
      field: 'modelId',
      value: 'PP-StructureV3'
    })
    expect(preferenceService.editFileProcessorOption).toHaveBeenNthCalledWith(3, 'tesseract', {
      type: 'langs',
      langs: ['eng', 'chi_sim']
    })
    expect(setOverridesMock).not.toHaveBeenCalled()
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
