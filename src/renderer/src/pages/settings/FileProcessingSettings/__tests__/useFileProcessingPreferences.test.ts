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

  it('serializes override updates and derives each write from the latest pending state', async () => {
    const { result } = renderHook(() => useFileProcessingPreferences())

    const apiKeysUpdate = result.current.setApiKeys('mistral', ['mistral-key'])
    const modelUpdate = result.current.setCapabilityField(
      'paddleocr',
      'document_to_markdown',
      'modelId',
      'PP-StructureV3'
    )

    await Promise.all([apiKeysUpdate, modelUpdate])

    expect(setPreferencesMock).toHaveBeenNthCalledWith(1, {
      overrides: {
        mistral: {
          apiKeys: ['mistral-key']
        }
      }
    })
    expect(setPreferencesMock).toHaveBeenNthCalledWith(2, {
      overrides: {
        mistral: {
          apiKeys: ['mistral-key']
        },
        paddleocr: {
          capabilities: {
            document_to_markdown: {
              modelId: 'PP-StructureV3'
            }
          }
        }
      }
    })
  })
})
