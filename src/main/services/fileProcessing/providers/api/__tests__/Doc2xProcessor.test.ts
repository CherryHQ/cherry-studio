/**
 * Doc2xProcessor Tests
 *
 * Tests for the Doc2X document processor covering:
 * - convertToMarkdown flow
 * - getStatus polling logic
 * - convertRequested cleanup
 * - API error handling
 */

import * as fs from 'node:fs'

import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { FileMetadata } from '@types'
import { FileTypes } from '@types'
import { net } from 'electron'

import type { ProcessingContext } from '../../../types'
import { Doc2xProcessor } from '../Doc2xProcessor'

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

describe('Doc2xProcessor', () => {
  let processor: Doc2xProcessor
  let mockConfig: FileProcessorMerged
  let mockFile: FileMetadata
  let mockContext: ProcessingContext

  beforeEach(() => {
    vi.clearAllMocks()

    processor = new Doc2xProcessor()

    mockConfig = {
      id: 'doc2x',
      type: 'api',
      capabilities: [
        {
          feature: 'markdown_conversion',
          input: 'document',
          output: 'markdown',
          apiHost: 'https://api.doc2x.com'
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
    vi.mocked(fs.createReadStream).mockReturnValue({} as fs.ReadStream)
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined)
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined)
    vi.mocked(fs.unlinkSync).mockReturnValue(undefined)
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.promises.stat).mockResolvedValue({ size: 1024 } as fs.Stats)
    vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from('mock pdf content'))
  })

  describe('constructor', () => {
    it('should create processor with correct id', () => {
      expect(processor.id).toBe('doc2x')
    })

    it('should expose template', () => {
      expect(processor.template).toBeDefined()
      expect(processor.template.id).toBe('doc2x')
    })
  })

  describe('convertToMarkdown', () => {
    it('should upload file and return providerTaskId', async () => {
      // Mock preupload response
      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 'success',
            data: { uid: 'test-uid', url: 'https://upload.url' }
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
      expect(payload.uid).toBe('test-uid')
      expect(payload.fileId).toBe('test-file-id')
    })

    it('should throw error when preupload fails', async () => {
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
          code: 'error',
          message: 'Invalid API key'
        })
      } as Response)

      await expect(processor.convertToMarkdown(mockFile, mockConfig, mockContext)).rejects.toThrow(
        'API returned error: Invalid API key'
      )
    })

    it('should throw error when API key is missing', async () => {
      const configWithoutKey = { ...mockConfig, apiKeys: undefined }

      await expect(processor.convertToMarkdown(mockFile, configWithoutKey, mockContext)).rejects.toThrow(
        /API key.*required/i
      )
    })

    it('should check cancellation', async () => {
      const abortController = new AbortController()
      abortController.abort()
      const cancelledContext = { ...mockContext, signal: abortController.signal }

      await expect(processor.convertToMarkdown(mockFile, mockConfig, cancelledContext)).rejects.toThrow(
        'Processing cancelled'
      )
    })
  })

  describe('getStatus', () => {
    const validProviderTaskId = JSON.stringify({
      uid: 'test-uid',
      fileId: 'test-file-id',
      fileName: 'test',
      originalName: 'test.pdf'
    })

    it('should return processing status when parsing in progress', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 'success',
          data: { status: 'parsing', progress: 50 }
        })
      } as Response)

      const result = await processor.getStatus(validProviderTaskId, mockConfig)

      expect(result.status).toBe('processing')
      expect(result.progress).toBe(50)
    })

    it('should trigger conversion when parsing succeeds', async () => {
      // Mock getParseStatus - success
      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 'success',
            data: { status: 'success', progress: 100 }
          })
        } as Response)
        // Mock convertFile
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ code: 'success' })
        } as Response)
        // Mock getParsedFile - still processing
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 'success',
            data: { status: 'processing', url: '' }
          })
        } as Response)

      const result = await processor.getStatus(validProviderTaskId, mockConfig)

      expect(result.status).toBe('processing')
      expect(result.progress).toBe(90)
    })

    it('should return completed when export is ready', async () => {
      // Mock getParseStatus - success
      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 'success',
            data: { status: 'success', progress: 100 }
          })
        } as Response)
        // Mock convertFile
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ code: 'success' })
        } as Response)
        // Mock getParsedFile - success with URL
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 'success',
            data: { status: 'success', url: 'https://download.url/result.zip' }
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
      expect(result.result?.markdownPath).toBeDefined()
    })

    it('should return failed when parsing fails', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 'success',
          data: { status: 'failed', progress: 0, detail: 'Invalid PDF format' }
        })
      } as Response)

      const result = await processor.getStatus(validProviderTaskId, mockConfig)

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('processing_failed')
      expect(result.error?.message).toContain('Invalid PDF format')
    })

    it('should return failed when export fails', async () => {
      // Mock getParseStatus - success
      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 'success',
            data: { status: 'success', progress: 100 }
          })
        } as Response)
        // Mock convertFile
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ code: 'success' })
        } as Response)
        // Mock getParsedFile - failed
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 'success',
            data: { status: 'failed', url: '', detail: 'Export failed' }
          })
        } as Response)

      const result = await processor.getStatus(validProviderTaskId, mockConfig)

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('export_failed')
    })

    it('should return error for invalid providerTaskId', async () => {
      const result = await processor.getStatus('invalid-json', mockConfig)

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('get_status_error')
    })

    it('should return error for missing fields in providerTaskId', async () => {
      const invalidPayload = JSON.stringify({ uid: 'test-uid' }) // missing other fields

      const result = await processor.getStatus(invalidPayload, mockConfig)

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('get_status_error')
    })

    it('should handle network errors gracefully', async () => {
      vi.mocked(net.fetch).mockRejectedValueOnce(new Error('Network error'))

      const result = await processor.getStatus(validProviderTaskId, mockConfig)

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('status_query_failed')
      expect(result.error?.message).toContain('Network error')
    })

    it('should not call convertFile twice for same uid', async () => {
      // First call - triggers conversion
      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 'success',
            data: { status: 'success', progress: 100 }
          })
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ code: 'success' })
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 'success',
            data: { status: 'processing', url: '' }
          })
        } as Response)

      await processor.getStatus(validProviderTaskId, mockConfig)

      // Second call - should not call convertFile again
      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 'success',
            data: { status: 'success', progress: 100 }
          })
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 'success',
            data: { status: 'processing', url: '' }
          })
        } as Response)

      await processor.getStatus(validProviderTaskId, mockConfig)

      // convertFile should only be called once (second call in first getStatus)
      const fetchCalls = vi.mocked(net.fetch).mock.calls
      // Filter for convertFile endpoint (POST /convert/parse without /result)
      const convertCalls = fetchCalls.filter((call) => {
        const url = call[0] as string
        return url.includes('/convert/parse') && !url.includes('/result')
      })
      expect(convertCalls.length).toBe(1)
    })
  })

  describe('convertRequested cleanup', () => {
    it('should cleanup old entries after TTL', async () => {
      const validProviderTaskId = JSON.stringify({
        uid: 'test-uid',
        fileId: 'test-file-id',
        fileName: 'test',
        originalName: 'test.pdf'
      })

      // First call at time 0
      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 'success',
            data: { status: 'success', progress: 100 }
          })
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ code: 'success' })
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            code: 'success',
            data: { status: 'processing', url: '' }
          })
        } as Response)

      await processor.getStatus(validProviderTaskId, mockConfig)

      // Access private property for testing (using type assertion)
      const processorWithPrivate = processor as unknown as { convertRequested: Map<string, number> }
      expect(processorWithPrivate.convertRequested.has('test-uid')).toBe(true)
    })
  })
})
