import { DataApiErrorFactory, ErrorCode } from '@shared/data/api'
import { PRESETS_FILE_PROCESSORS } from '@shared/data/presets/file-processing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { updateProcessorMock } = vi.hoisted(() => ({
  updateProcessorMock: vi.fn()
}))

vi.mock('@data/services/FileProcessingService', () => ({
  fileProcessingService: {
    getProcessors: vi.fn(),
    getProcessorById: vi.fn(),
    updateProcessor: updateProcessorMock
  }
}))

import { fileProcessingHandlers } from '../fileProcessing'

describe('fileProcessingHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('PATCH /file-processing/processors/:id', () => {
    it('should throw a validation error when body validation fails', async () => {
      await expect(
        fileProcessingHandlers['/file-processing/processors/:id'].PATCH({
          params: { id: 'paddleocr' },
          body: {
            capabilities: {
              markdown_conversion: {
                apiHost: 'not-a-url'
              }
            }
          } as never
        })
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        status: 422,
        details: {
          fieldErrors: {
            'capabilities.markdown_conversion.apiHost': expect.arrayContaining([expect.any(String)])
          }
        }
      })

      expect(updateProcessorMock).not.toHaveBeenCalled()
    })

    it('should pass validated updates to the service', async () => {
      const mergedProcessor = {
        ...PRESETS_FILE_PROCESSORS.find((processor) => processor.id === 'paddleocr')!,
        apiKeys: ['new-key']
      }
      updateProcessorMock.mockResolvedValueOnce(mergedProcessor)

      const result = await fileProcessingHandlers['/file-processing/processors/:id'].PATCH({
        params: { id: 'paddleocr' },
        body: {
          apiKeys: ['new-key']
        }
      })

      expect(updateProcessorMock).toHaveBeenCalledWith('paddleocr', {
        apiKeys: ['new-key']
      })
      expect(result).toEqual(mergedProcessor)
    })

    it('should propagate service errors without wrapping them', async () => {
      const serviceError = DataApiErrorFactory.notFound('File processor', 'missing-processor')
      updateProcessorMock.mockRejectedValueOnce(serviceError)

      await expect(
        fileProcessingHandlers['/file-processing/processors/:id'].PATCH({
          params: { id: 'missing-processor' as never },
          body: {
            apiKeys: ['new-key']
          }
        })
      ).rejects.toBe(serviceError)
    })
  })
})
