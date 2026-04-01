import { fileProcessingService as dataFileProcessingService } from '@data/services/FileProcessingService'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it } from 'vitest'

import { resolveProcessorConfig } from '../config'

describe('resolveProcessorConfig', () => {
  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
  })

  it('uses the explicit processor id when provided and merges capability overrides', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {
      doc2x: {
        apiKeys: ['doc-key'],
        capabilities: {
          markdown_conversion: {
            apiHost: 'https://doc2x-proxy.example.com',
            modelId: 'doc2x-custom'
          }
        }
      }
    })

    await expect(resolveProcessorConfig('markdown_conversion', 'doc2x')).resolves.toMatchObject({
      id: 'doc2x',
      apiKeys: ['doc-key'],
      capabilities: [
        expect.objectContaining({
          feature: 'markdown_conversion',
          apiHost: 'https://doc2x-proxy.example.com',
          modelId: 'doc2x-custom'
        })
      ]
    })
  })

  it('falls back to the feature default processor preference', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.default_text_extraction', 'tesseract')
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {
      tesseract: {
        options: {
          langs: ['eng']
        }
      }
    })

    await expect(resolveProcessorConfig('text_extraction')).resolves.toMatchObject({
      id: 'tesseract',
      options: {
        langs: ['eng']
      }
    })
  })

  it('fails fast when neither explicit processor id nor default preference is available', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.default_markdown_conversion', null)

    await expect(resolveProcessorConfig('markdown_conversion')).rejects.toThrow(
      'Default file processor for markdown_conversion is not configured'
    )
  })

  it('keeps runtime and data-service merged processor configs in sync', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {
      paddleocr: {
        apiKeys: ['sync-key'],
        options: {
          concurrency: 2
        },
        capabilities: {
          markdown_conversion: {
            apiHost: 'https://override.example.com',
            modelId: 'override-model'
          }
        }
      }
    })

    const [runtimeConfig, dataConfig] = await Promise.all([
      resolveProcessorConfig('markdown_conversion', 'paddleocr'),
      dataFileProcessingService.getProcessorById('paddleocr')
    ])

    expect(runtimeConfig).toEqual(dataConfig)
  })
})
