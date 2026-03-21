import { describe, expect, it } from 'vitest'

import { mergeFileProcessingOverrides } from '../FileProcessingOverrideMappings'

describe('FileProcessingOverrideMappings', () => {
  describe('mergeFileProcessingOverrides', () => {
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
              markdown_conversion: {
                apiHost: 'https://mineru-proxy.example.com'
              }
            },
            options: { enable_formula: false }
          },
          mistral: {
            apiKeys: ['mistral-key'],
            capabilities: {
              markdown_conversion: {
                apiHost: 'https://mistral-proxy.example.com',
                modelId: 'mistral-ocr-custom'
              },
              text_extraction: {
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

    it('should apply mistral preprocess credentials to both markdown and text extraction', () => {
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
              markdown_conversion: {
                apiHost: 'https://mistral-proxy.example.com',
                modelId: 'mistral-ocr-custom'
              },
              text_extraction: {
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
  })
})
