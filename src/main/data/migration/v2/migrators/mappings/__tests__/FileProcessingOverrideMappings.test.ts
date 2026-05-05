import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../../../../tests/__mocks__/MainLoggerService'
import { mergeFileProcessingOverrides } from '../FileProcessingOverrideMappings'

describe('FileProcessingOverrideMappings', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('mergeFileProcessingOverrides', () => {
    it('should return empty overrides when preprocess and ocr sources are missing', () => {
      const result = mergeFileProcessingOverrides({})

      expect(result).toEqual({
        'feature.file_processing.overrides': {}
      })
    })

    it('should merge preprocess and ocr providers into file processing overrides', () => {
      const result = mergeFileProcessingOverrides({
        preprocessProviders: [
          {
            id: 'mineru',
            name: 'MinerU',
            apiKey: 'mineru-key',
            apiHost: 'https://mineru-proxy.example.com',
            options: { enable_formula: false }
          },
          {
            id: 'mistral',
            name: 'Mistral',
            apiKey: 'mistral-key',
            apiHost: 'https://mistral-proxy.example.com',
            model: 'mistral-ocr-custom'
          },
          {
            id: 'paddleocr',
            name: 'PaddleOCR',
            apiKey: 'paddle-doc-key',
            apiHost: 'https://paddle-doc.example.com'
          }
        ],
        ocrProviders: [
          {
            id: 'paddleocr',
            name: 'PaddleOCR',
            capabilities: { image: true },
            config: {
              apiUrl: 'https://paddle-ocr.example.com',
              accessToken: 'paddle-ocr-token'
            }
          },
          {
            id: 'tesseract',
            name: 'Tesseract',
            capabilities: { image: true },
            config: {
              langs: {
                eng: true,
                chi_sim: false,
                fra: true
              }
            }
          },
          {
            id: 'system',
            name: 'System',
            capabilities: { image: true },
            config: {
              langs: ['en-us', 'zh-cn']
            }
          }
        ]
      })

      expect(result).toEqual({
        'feature.file_processing.overrides': {
          mineru: {
            apiKeys: ['mineru-key'],
            capabilities: {
              document_to_markdown: {
                apiHost: 'https://mineru-proxy.example.com'
              }
            },
            options: { enable_formula: false }
          },
          mistral: {
            apiKeys: ['mistral-key'],
            capabilities: {
              document_to_markdown: {
                apiHost: 'https://mistral-proxy.example.com',
                modelId: 'mistral-ocr-custom'
              }
            }
          },
          paddleocr: {
            apiKeys: ['paddle-doc-key', 'paddle-ocr-token']
          },
          system: {
            options: {
              langs: ['en-us', 'zh-cn']
            }
          },
          tesseract: {
            options: {
              langs: ['eng', 'fra']
            }
          }
        }
      })
    })

    it('should not migrate paddleocr api hosts and only keep keys', () => {
      const result = mergeFileProcessingOverrides({
        preprocessProviders: [
          {
            id: 'paddleocr',
            name: 'PaddleOCR',
            apiKey: 'paddle-doc-key',
            apiHost: 'https://paddle-doc.example.com'
          }
        ],
        ocrProviders: [
          {
            id: 'paddleocr',
            name: 'PaddleOCR',
            capabilities: { image: true },
            config: {
              apiUrl: 'https://paddle-ocr.example.com',
              accessToken: 'paddle-ocr-token'
            }
          }
        ]
      })

      expect(result).toEqual({
        'feature.file_processing.overrides': {
          paddleocr: {
            apiKeys: ['paddle-doc-key', 'paddle-ocr-token']
          }
        }
      })
    })

    it('should apply mistral preprocess credentials to markdown conversion', () => {
      const result = mergeFileProcessingOverrides({
        preprocessProviders: [
          {
            id: 'mistral',
            name: 'Mistral',
            apiKey: 'mistral-key',
            apiHost: 'https://mistral-proxy.example.com',
            model: 'mistral-ocr-custom'
          }
        ],
        ocrProviders: []
      })

      expect(result).toEqual({
        'feature.file_processing.overrides': {
          mistral: {
            apiKeys: ['mistral-key'],
            capabilities: {
              document_to_markdown: {
                apiHost: 'https://mistral-proxy.example.com',
                modelId: 'mistral-ocr-custom'
              }
            }
          }
        }
      })
    })

    it('should skip empty values and preset defaults', () => {
      const result = mergeFileProcessingOverrides({
        preprocessProviders: [
          {
            id: 'doc2x',
            name: 'Doc2x',
            apiKey: '',
            apiHost: 'https://v2.doc2x.noedgeai.com'
          },
          {
            id: 'open-mineru',
            name: 'Open MinerU',
            apiKey: '',
            apiHost: ''
          }
        ],
        ocrProviders: []
      })

      expect(result).toEqual({
        'feature.file_processing.overrides': {}
      })
    })

    it('should warn when unknown preprocess or ocr providers are skipped', () => {
      const warnSpy = vi.spyOn(mockMainLoggerService, 'warn').mockImplementation(() => {})

      const result = mergeFileProcessingOverrides({
        preprocessProviders: [
          {
            id: 'custom-preprocess',
            name: 'Custom Preprocess',
            apiKey: 'secret-key'
          }
        ],
        ocrProviders: [
          {
            id: 'custom-ocr',
            name: 'Custom OCR',
            config: {
              accessToken: 'secret-token'
            }
          }
        ]
      })

      expect(result).toEqual({
        'feature.file_processing.overrides': {}
      })
      expect(warnSpy).toHaveBeenCalledTimes(2)
      expect(warnSpy).toHaveBeenNthCalledWith(
        1,
        'Skipping unknown preprocess provider during file processing migration',
        { providerId: 'custom-preprocess' }
      )
      expect(warnSpy).toHaveBeenNthCalledWith(2, 'Skipping unknown OCR provider during file processing migration', {
        providerId: 'custom-ocr'
      })
    })

    it('should warn when ocr langs has an invalid type', () => {
      const warnSpy = vi.spyOn(mockMainLoggerService, 'warn').mockImplementation(() => {})

      const result = mergeFileProcessingOverrides({
        preprocessProviders: [],
        ocrProviders: [
          {
            id: 'system',
            name: 'System',
            capabilities: { image: true },
            config: {
              langs: 'en-us'
            }
          }
        ]
      })

      expect(result).toEqual({
        'feature.file_processing.overrides': {}
      })
      expect(warnSpy).toHaveBeenCalledWith('Skipping invalid OCR langs during file processing migration', {
        providerId: 'system',
        valueType: 'string'
      })
    })

    it('should migrate nested ocr api config fields', () => {
      const result = mergeFileProcessingOverrides({
        preprocessProviders: [],
        ocrProviders: [
          {
            id: 'ovocr',
            name: 'OVOCR',
            capabilities: { image: true },
            config: {
              api: {
                apiKey: 'ovocr-key',
                apiHost: 'https://ovocr.example.com',
                apiVersion: '2026-03-23'
              }
            }
          }
        ]
      })

      expect(result).toEqual({
        'feature.file_processing.overrides': {
          ovocr: {
            apiKeys: ['ovocr-key'],
            capabilities: {
              image_to_text: {
                apiHost: 'https://ovocr.example.com'
              }
            },
            options: {
              apiVersion: '2026-03-23'
            }
          }
        }
      })
    })

    it('should dedupe duplicate api keys during migration', () => {
      const result = mergeFileProcessingOverrides({
        preprocessProviders: [],
        ocrProviders: [
          {
            id: 'ovocr',
            name: 'OVOCR',
            capabilities: { image: true },
            config: {
              accessToken: 'shared-key',
              api: {
                apiKey: 'shared-key'
              }
            }
          }
        ]
      })

      expect(result).toEqual({
        'feature.file_processing.overrides': {
          ovocr: {
            apiKeys: ['shared-key']
          }
        }
      })
    })
  })
})
