import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@data/PreferenceService', async () => {
  const { MockMainPreferenceServiceExport } = await import('@test-mocks/main/PreferenceService')
  return MockMainPreferenceServiceExport
})

import { PRESETS_FILE_PROCESSORS } from '@shared/data/presets/file-processing'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'

import { fileProcessingService } from '../FileProcessingService'

describe('FileProcessingService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
  })

  describe('getProcessors', () => {
    it('should return all processors with merged overrides', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('file_processing.overrides', {
        paddleocr: {
          apiKeys: ['test-key'],
          options: {
            concurrency: 2
          },
          capabilities: {
            markdown_conversion: {
              modelId: 'custom-model'
            }
          }
        }
      })

      const processors = await fileProcessingService.getProcessors()
      const processor = processors.find((item) => item.id === 'paddleocr')

      expect(processors).toHaveLength(PRESETS_FILE_PROCESSORS.length)
      expect(processor).toMatchObject({
        id: 'paddleocr',
        apiKeys: ['test-key'],
        options: {
          concurrency: 2
        }
      })
      expect(processor?.capabilities).toContainEqual(
        expect.objectContaining({
          feature: 'markdown_conversion',
          modelId: 'custom-model'
        })
      )
    })
  })

  describe('getProcessorById', () => {
    it('should throw when processor does not exist', async () => {
      await expect(fileProcessingService.getProcessorById('missing-processor' as never)).rejects.toThrow(
        "File processor with id 'missing-processor' not found"
      )
    })
  })

  describe('updateProcessor', () => {
    it('should merge processor overrides and preserve existing feature-specific capability fields', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('file_processing.overrides', {
        paddleocr: {
          capabilities: {
            markdown_conversion: {
              apiHost: 'https://old.example.com'
            }
          },
          options: {
            existing: true
          }
        }
      })

      const updated = await fileProcessingService.updateProcessor('paddleocr', {
        capabilities: {
          markdown_conversion: {
            modelId: 'new-model'
          }
        },
        options: {
          timeout: 30000
        }
      })

      expect(updated.capabilities).toContainEqual(
        expect.objectContaining({
          feature: 'markdown_conversion',
          apiHost: 'https://old.example.com',
          modelId: 'new-model'
        })
      )
      expect(updated.options).toMatchObject({
        existing: true,
        timeout: 30000
      })

      expect(MockMainPreferenceServiceUtils.getPreferenceValue('file_processing.overrides')).toMatchObject({
        paddleocr: {
          capabilities: {
            markdown_conversion: {
              apiHost: 'https://old.example.com',
              modelId: 'new-model'
            }
          },
          options: {
            existing: true,
            timeout: 30000
          }
        }
      })
    })
  })
})
