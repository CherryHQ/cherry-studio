/**
 * MineruProcessor Tests
 *
 * Tests for the MinerU document processor covering:
 * - convertToMarkdown batch upload flow
 * - parseProviderTaskId validation
 * - getStatus polling logic
 * - downloadAndExtractMarkdown ZIP handling
 */

import * as fs from 'node:fs'

import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { ProcessResultResponse } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { FileTypes } from '@types'
import { net } from 'electron'

import type { ProcessingContext } from '../../../types'
import { MineruProcessor } from '../MineruProcessor'

// net.fetch is mocked in global setup (tests/main.setup.ts)

vi.mock('@main/services/FileStorage', () => ({
  fileStorage: {
    getFilePathById: vi.fn().mockReturnValue('/path/to/test.pdf')
  }
}))

vi.mock('adm-zip', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      extractAllTo: vi.fn()
    }))
  }
})

const assertCompletedResponse = (
  response: ProcessResultResponse
): Extract<ProcessResultResponse, { status: 'completed' }> => {
  if (response.status !== 'completed') {
    throw new Error(`Expected completed status, got ${response.status}`)
  }
  return response
}

const assertFailedResponse = (
  response: ProcessResultResponse
): Extract<ProcessResultResponse, { status: 'failed' }> => {
  if (response.status !== 'failed') {
    throw new Error(`Expected failed status, got ${response.status}`)
  }
  return response
}

describe('MineruProcessor', () => {
  let processor: MineruProcessor
  let mockConfig: FileProcessorMerged
  let mockFile: FileMetadata
  let mockContext: ProcessingContext

  beforeEach(() => {
    vi.clearAllMocks()

    processor = new MineruProcessor()

    mockConfig = {
      id: 'mineru',
      type: 'api',
      capabilities: [
        {
          feature: 'markdown_conversion',
          input: 'document',
          output: 'markdown',
          apiHost: 'https://api.mineru.com'
        }
      ],
      apiKeys: ['test-api-key']
    }

    mockFile = {
      id: 'test-file-id',
      name: 'test.pdf',
      origin_name: 'test.pdf',
      path: '/path/to/test.pdf',
      size: 1024,
      ext: '.pdf',
      type: FileTypes.DOCUMENT,
      created_at: new Date().toISOString(),
      count: 1
    }

    mockContext = {
      requestId: 'test-request-id',
      signal: new AbortController().signal
    }

    // Mock fs methods
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined)
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined)
    vi.mocked(fs.unlinkSync).mockReturnValue(undefined)
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['result.md'] as any)
    vi.mocked(fs.promises.stat).mockResolvedValue({ size: 1024 } as fs.Stats)
    vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from('mock pdf content'))
  })

  describe('constructor', () => {
    it('should create processor with correct id', () => {
      expect(processor.id).toBe('mineru')
    })

    it('should expose template', () => {
      expect(processor.template).toBeDefined()
      expect(processor.template.id).toBe('mineru')
    })
  })

  describe('convertToMarkdown', () => {
    it('should get batch upload URL and upload file', async () => {
      // Mock getBatchUploadUrls response
      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 0,
            data: {
              batch_id: 'test-batch-id',
              file_urls: ['https://upload.url'],
              headers: [{ 'Content-Type': 'application/octet-stream' }]
            }
          })
        } as Response)
        // Mock PUT file response
        .mockResolvedValueOnce({
          ok: true
        } as Response)

      const result = await processor.convertToMarkdown(mockFile, mockConfig, mockContext)

      expect(result.metadata).toBeDefined()
      expect(result.metadata?.providerTaskId).toBeDefined()

      const payload = JSON.parse(result.metadata!.providerTaskId as string)
      expect(payload.batchId).toBe('test-batch-id')
      expect(payload.fileId).toBe('test-file-id')
    })

    it('should include optionalPayload in batch upload body', async () => {
      const optionalPayload = {
        enable_formula: false,
        enable_table: true,
        language: 'auto',
        is_ocr: false
      }
      mockConfig = {
        ...mockConfig,
        capabilities: [
          {
            ...mockConfig.capabilities[0],
            metadata: {
              optionalPayload
            }
          }
        ]
      }

      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 0,
            data: {
              batch_id: 'test-batch-id',
              file_urls: ['https://upload.url']
            }
          })
        } as Response)
        .mockResolvedValueOnce({
          ok: true
        } as Response)

      await processor.convertToMarkdown(mockFile, mockConfig, mockContext)

      const fetchCall = vi.mocked(net.fetch).mock.calls[0]
      const options = fetchCall[1] as RequestInit
      const body = JSON.parse(options.body as string) as Record<string, unknown>

      expect(body.enable_formula).toBe(false)
      expect(body.enable_table).toBe(true)
      expect(body.language).toBe('auto')
      expect(body).not.toHaveProperty('is_ocr')

      const files = body.files as Array<Record<string, unknown>>
      expect(files).toHaveLength(1)
      expect(files[0]).toMatchObject({
        name: mockFile.origin_name,
        data_id: mockFile.id,
        is_ocr: false
      })
    })

    it('should throw error when batch upload fails', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      } as Response)

      await expect(processor.convertToMarkdown(mockFile, mockConfig, mockContext)).rejects.toThrow(
        'HTTP 500: Internal Server Error'
      )
    })

    it('should throw error when API returns error code', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 1,
          msg: 'Invalid request'
        })
      } as Response)

      await expect(processor.convertToMarkdown(mockFile, mockConfig, mockContext)).rejects.toThrow(
        'API returned error: Invalid request'
      )
    })

    it('should throw error when API key is missing', async () => {
      const configWithoutKey = { ...mockConfig, apiKeys: undefined }

      await expect(processor.convertToMarkdown(mockFile, configWithoutKey, mockContext)).rejects.toThrow(
        /API key.*required/i
      )
    })

    it('should check cancellation after upload', async () => {
      const abortController = new AbortController()

      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 0,
            data: {
              batch_id: 'test-batch-id',
              file_urls: ['https://upload.url']
            }
          })
        } as Response)
        .mockImplementationOnce(async () => {
          // Abort during upload
          abortController.abort()
          return { ok: true } as Response
        })

      const cancelledContext = { ...mockContext, signal: abortController.signal }

      await expect(processor.convertToMarkdown(mockFile, mockConfig, cancelledContext)).rejects.toThrow(
        'Processing cancelled'
      )
    })
  })

  describe('getStatus', () => {
    const validProviderTaskId = JSON.stringify({
      batchId: 'test-batch-id',
      fileId: 'test-file-id',
      fileName: 'test.pdf',
      originalName: 'test.pdf'
    })

    it('should return processing status when file is pending', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            batch_id: 'test-batch-id',
            extract_result: [
              {
                file_name: 'test.pdf',
                state: 'pending',
                err_msg: ''
              }
            ]
          }
        })
      } as Response)

      const result = await processor.getStatus(validProviderTaskId, mockConfig)

      expect(result.status).toBe('processing')
      expect(result.progress).toBe(0)
    })

    it('should return processing status with progress when running', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            batch_id: 'test-batch-id',
            extract_result: [
              {
                file_name: 'test.pdf',
                state: 'running',
                err_msg: '',
                extract_progress: {
                  extracted_pages: 5,
                  total_pages: 10,
                  start_time: new Date().toISOString()
                }
              }
            ]
          }
        })
      } as Response)

      const result = await processor.getStatus(validProviderTaskId, mockConfig)

      expect(result.status).toBe('processing')
      expect(result.progress).toBe(50)
    })

    it('should return completed when extraction is done', async () => {
      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 0,
            data: {
              batch_id: 'test-batch-id',
              extract_result: [
                {
                  file_name: 'test.pdf',
                  state: 'done',
                  err_msg: '',
                  full_zip_url: 'https://download.url/result.zip'
                }
              ]
            }
          })
        } as Response)
        // Mock download ZIP
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(100)
        } as Response)

      const result = await processor.getStatus(validProviderTaskId, mockConfig)

      expect(result.status).toBe('completed')
      expect(result.progress).toBe(100)
      const completed = assertCompletedResponse(result)
      expect(completed.result.markdownPath).toBeDefined()
    })

    it('should return failed when extraction fails', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            batch_id: 'test-batch-id',
            extract_result: [
              {
                file_name: 'test.pdf',
                state: 'failed',
                err_msg: 'PDF parsing failed'
              }
            ]
          }
        })
      } as Response)

      const result = await processor.getStatus(validProviderTaskId, mockConfig)

      expect(result.status).toBe('failed')
      const failed = assertFailedResponse(result)
      expect(failed.error.code).toBe('processing_failed')
      expect(failed.error.message).toContain('PDF parsing failed')
    })

    it('should return processing when file not found in results', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            batch_id: 'test-batch-id',
            extract_result: []
          }
        })
      } as Response)

      const result = await processor.getStatus(validProviderTaskId, mockConfig)

      expect(result.status).toBe('processing')
      expect(result.progress).toBe(0)
    })

    it('should return error for invalid providerTaskId JSON', async () => {
      const result = await processor.getStatus('invalid-json', mockConfig)

      expect(result.status).toBe('failed')
      const failed = assertFailedResponse(result)
      expect(failed.error.code).toBe('status_query_failed')
    })

    it('should return error for missing fields in providerTaskId', async () => {
      const invalidPayload = JSON.stringify({ batchId: 'test-batch-id' }) // missing other fields

      const result = await processor.getStatus(invalidPayload, mockConfig)

      expect(result.status).toBe('failed')
      const failed = assertFailedResponse(result)
      expect(failed.error.code).toBe('status_query_failed')
      expect(failed.error.message).toContain('Missing required fields')
    })

    it('should handle network errors gracefully', async () => {
      vi.mocked(net.fetch).mockRejectedValueOnce(new Error('Network error'))

      const result = await processor.getStatus(validProviderTaskId, mockConfig)

      expect(result.status).toBe('failed')
      const failed = assertFailedResponse(result)
      expect(failed.error.code).toBe('status_query_failed')
      expect(failed.error.message).toContain('Network error')
    })

    it('should cap progress at 99 during processing', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            batch_id: 'test-batch-id',
            extract_result: [
              {
                file_name: 'test.pdf',
                state: 'running',
                err_msg: '',
                extract_progress: {
                  extracted_pages: 100,
                  total_pages: 100,
                  start_time: new Date().toISOString()
                }
              }
            ]
          }
        })
      } as Response)

      const result = await processor.getStatus(validProviderTaskId, mockConfig)

      expect(result.status).toBe('processing')
      expect(result.progress).toBe(99) // Capped at 99, not 100
    })
  })

  describe('downloadAndExtractMarkdown', () => {
    it('should throw error when markdown file not found in ZIP', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue(['image.png'] as any)

      const validProviderTaskId = JSON.stringify({
        batchId: 'test-batch-id',
        fileId: 'test-file-id',
        fileName: 'test.pdf',
        originalName: 'test.pdf'
      })

      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 0,
            data: {
              batch_id: 'test-batch-id',
              extract_result: [
                {
                  file_name: 'test.pdf',
                  state: 'done',
                  err_msg: '',
                  full_zip_url: 'https://download.url/result.zip'
                }
              ]
            }
          })
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(100)
        } as Response)

      const result = await processor.getStatus(validProviderTaskId, mockConfig)

      expect(result.status).toBe('failed')
      const failed = assertFailedResponse(result)
      expect(failed.error.message).toContain('No markdown file found')
    })

    it('should throw error when download fails', async () => {
      const validProviderTaskId = JSON.stringify({
        batchId: 'test-batch-id',
        fileId: 'test-file-id',
        fileName: 'test.pdf',
        originalName: 'test.pdf'
      })

      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 0,
            data: {
              batch_id: 'test-batch-id',
              extract_result: [
                {
                  file_name: 'test.pdf',
                  state: 'done',
                  err_msg: '',
                  full_zip_url: 'https://download.url/result.zip'
                }
              ]
            }
          })
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found'
        } as Response)

      const result = await processor.getStatus(validProviderTaskId, mockConfig)

      expect(result.status).toBe('failed')
      const failed = assertFailedResponse(result)
      expect(failed.error.code).toBe('status_query_failed')
    })
  })
})
