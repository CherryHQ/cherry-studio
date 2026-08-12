import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isSupportedSystemMock, isLocalModelReadyMock } = vi.hoisted(() => ({
  isSupportedSystemMock: vi.fn(() => true),
  isLocalModelReadyMock: vi.fn(() => true)
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')

  return mockApplicationFactory()
})

vi.mock('@main/services/localModel', () => ({
  isLocalModelReady: isLocalModelReadyMock
}))

vi.mock('../../processors/registry', () => ({
  processorRegistry: {
    tesseract: { isSupported: () => true },
    system: { isSupported: isSupportedSystemMock },
    paddleocr: { isSupported: () => true },
    'local-paddleocr': { isSupported: () => true },
    'local-document': { isSupported: () => true },
    ovocr: { isSupported: () => true },
    mineru: { isSupported: () => true },
    doc2x: { isSupported: () => true },
    mistral: { isSupported: () => true },
    'open-mineru': { isSupported: () => true }
  }
}))

const { resolveDefaultImageToTextProcessorMock } = vi.hoisted(() => ({
  resolveDefaultImageToTextProcessorMock: vi.fn(() => 'tesseract' as const)
}))

vi.mock('../defaultImageToTextProcessor', () => ({
  resolveDefaultImageToTextProcessor: resolveDefaultImageToTextProcessorMock
}))

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'

import { getFileProcessorConfigById, resolveProcessorConfigByFeature } from '../resolveProcessorConfig'

describe('resolveProcessorConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    isSupportedSystemMock.mockReturnValue(true)
    isLocalModelReadyMock.mockReturnValue(true)
    resolveDefaultImageToTextProcessorMock.mockReturnValue('tesseract')
  })

  it('getFileProcessorConfigById merges preference override into preset config', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {
      'open-mineru': {
        apiKeys: ['secret-key'],
        capabilities: {
          document_to_markdown: {
            apiHost: 'http://127.0.0.1:9000'
          }
        },
        options: {
          langs: ['eng']
        }
      }
    })

    expect(getFileProcessorConfigById('open-mineru')).toEqual({
      id: 'open-mineru',
      type: 'api',
      capabilities: [
        {
          feature: 'document_to_markdown',
          inputs: ['document'],
          output: 'markdown',
          apiHost: 'http://127.0.0.1:9000'
        }
      ],
      apiKeys: ['secret-key'],
      options: {
        langs: ['eng']
      }
    })
  })

  it('getFileProcessorConfigById throws notFound for an unknown processor id', () => {
    expect(() => getFileProcessorConfigById('missing' as never)).toThrowError('File processor not found: missing')
  })

  it('uses the explicit processor when one is provided', () => {
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'feature.file_processing.default_document_to_markdown': 'open-mineru',
      'feature.file_processing.overrides': {
        paddleocr: {
          capabilities: {
            document_to_markdown: {
              modelId: 'paddle-custom'
            }
          }
        }
      }
    })

    const config = resolveProcessorConfigByFeature('document_to_markdown', 'paddleocr')

    expect(config.id).toBe('paddleocr')
    expect(config.capabilities.find((capability) => capability.feature === 'document_to_markdown')).toEqual(
      expect.objectContaining({
        feature: 'document_to_markdown',
        modelId: 'paddle-custom'
      })
    )
  })

  it('throws when the explicit processor does not support the requested feature', () => {
    expect(() => resolveProcessorConfigByFeature('document_to_markdown', 'tesseract')).toThrowError(
      'File processor tesseract does not support document_to_markdown'
    )
  })

  it('uses the feature default processor when processorId is omitted', () => {
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'feature.file_processing.default_image_to_text': 'mistral',
      'feature.file_processing.overrides': {
        mistral: {
          apiKeys: ['mistral-key']
        }
      }
    })

    expect(resolveProcessorConfigByFeature('image_to_text')).toEqual(
      expect.objectContaining({
        id: 'mistral',
        apiKeys: ['mistral-key']
      })
    )
  })

  it('fails fast when no default processor is configured and the feature has no fallback', () => {
    expect(() => resolveProcessorConfigByFeature('document_to_markdown')).toThrowError(
      'Default file processor for document_to_markdown is not configured'
    )
  })

  it('falls back to the platform default for image_to_text when the pref is unset', () => {
    resolveDefaultImageToTextProcessorMock.mockReturnValue('tesseract')

    expect(resolveProcessorConfigByFeature('image_to_text')).toEqual(expect.objectContaining({ id: 'tesseract' }))
    expect(resolveDefaultImageToTextProcessorMock).toHaveBeenCalled()
  })

  it('uses mistral when it is the default markdown processor', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.default_document_to_markdown', 'mistral')

    expect(resolveProcessorConfigByFeature('document_to_markdown')).toEqual(
      expect.objectContaining({
        id: 'mistral'
      })
    )
  })

  it('throws when the configured default processor does not support the requested feature', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.default_image_to_text', 'open-mineru')

    expect(() => resolveProcessorConfigByFeature('image_to_text')).toThrowError(
      'File processor open-mineru does not support image_to_text'
    )
  })

  it('throws when the configured default processor is not available on this platform', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.default_image_to_text', 'system')
    isSupportedSystemMock.mockReturnValue(false)

    expect(() => resolveProcessorConfigByFeature('image_to_text')).toThrowError(
      'File processor system is not available on this platform'
    )
  })

  // A missing model is fixable in one click; a missing platform API never is.
  // The two must not share a message — the platform wording sent users hunting
  // for an OS problem when all they had to do was download the model.
  it('distinguishes a missing local model from an unsupported platform', () => {
    isLocalModelReadyMock.mockReturnValue(false)

    expect(() => resolveProcessorConfigByFeature('document_to_markdown', 'local-document')).toThrowError(
      'File processor local-document needs the local ocr model to be downloaded first'
    )
    expect(isLocalModelReadyMock).toHaveBeenCalledWith('ocr')
  })

  it('accepts a local model processor once its model is ready', () => {
    expect(resolveProcessorConfigByFeature('document_to_markdown', 'local-document')).toEqual(
      expect.objectContaining({ id: 'local-document' })
    )
  })

  it('does not probe a local model for processors that need none', () => {
    isLocalModelReadyMock.mockReturnValue(false)

    expect(resolveProcessorConfigByFeature('document_to_markdown', 'paddleocr')).toEqual(
      expect.objectContaining({ id: 'paddleocr' })
    )
    expect(isLocalModelReadyMock).not.toHaveBeenCalled()
  })
})
