/**
 * OpenMineruProcessor Tests
 *
 * Tests for the Open MinerU document processor covering:
 * - convertToMarkdown upload and extract flow
 * - Retry logic
 * - ZIP handling
 * - Error scenarios
 */

import * as fs from 'node:fs'

import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { ProcessingResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { FileTypes } from '@types'
import { net } from 'electron'

import type { ProcessingContext } from '../../../types'
import { OpenMineruProcessor } from '../OpenMineruProcessor'

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

const assertMarkdownResult = (result: ProcessingResult): Extract<ProcessingResult, { markdownPath: string }> => {
  if (!('markdownPath' in result) || typeof result.markdownPath !== 'string') {
    throw new Error('Expected markdownPath in processing result')
  }
  return result
}

describe('OpenMineruProcessor', () => {
  let processor: OpenMineruProcessor
  let mockConfig: FileProcessorMerged
  let mockFile: FileMetadata
  let mockContext: ProcessingContext

  beforeEach(() => {
    vi.clearAllMocks()

    processor = new OpenMineruProcessor()

    mockConfig = {
      id: 'open-mineru',
      type: 'api',
      capabilities: [
        {
          feature: 'markdown_conversion',
          input: 'document',
          output: 'markdown',
          apiHost: 'http://localhost:8000'
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
      expect(processor.id).toBe('open-mineru')
    })

    it('should expose template', () => {
      expect(processor.template).toBeDefined()
      expect(processor.template.id).toBe('open-mineru')
    })
  })

  describe('convertToMarkdown', () => {
    // Tests that trigger retry logic need fake timers
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should upload file and extract markdown', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/zip' }),
        arrayBuffer: async () => new ArrayBuffer(100)
      } as Response)

      const result = await processor.convertToMarkdown(mockFile, mockConfig, mockContext)

      expect(assertMarkdownResult(result).markdownPath).toBeDefined()
      expect(assertMarkdownResult(result).markdownPath).toContain('result.md')
    })

    it('should throw error when response is not a ZIP', async () => {
      // Mock same response for all retries
      vi.mocked(net.fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        arrayBuffer: async () => new ArrayBuffer(100)
      } as Response)

      // Store error for assertion - attach catch handler immediately to prevent unhandled rejection
      let capturedError: Error | undefined
      const promise = processor.convertToMarkdown(mockFile, mockConfig, mockContext).catch((e) => {
        capturedError = e as Error
      })

      // Run all pending timers and wait for promise to settle
      await vi.runAllTimersAsync()
      await promise

      expect(capturedError?.message).toContain('Unexpected content-type: application/json')
    })

    it('should throw error when HTTP request fails', async () => {
      // Mock same response for all retries
      vi.mocked(net.fetch).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      } as Response)

      // Store error for assertion - attach catch handler immediately to prevent unhandled rejection
      let capturedError: Error | undefined
      const promise = processor.convertToMarkdown(mockFile, mockConfig, mockContext).catch((e) => {
        capturedError = e as Error
      })

      // Run all pending timers and wait for promise to settle
      await vi.runAllTimersAsync()
      await promise

      expect(capturedError?.message).toContain('HTTP 500: Internal Server Error')
    })

    it('should throw error when markdown file not found', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue(['image.png'] as any)

      // Mock same response for all retries
      vi.mocked(net.fetch).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/zip' }),
        arrayBuffer: async () => new ArrayBuffer(100)
      } as Response)

      // Store error for assertion - attach catch handler immediately to prevent unhandled rejection
      let capturedError: Error | undefined
      const promise = processor.convertToMarkdown(mockFile, mockConfig, mockContext).catch((e) => {
        capturedError = e as Error
      })

      // Run all pending timers and wait for promise to settle
      await vi.runAllTimersAsync()
      await promise

      expect(capturedError?.message).toContain('No markdown file found')
    })

    it('should check cancellation during processing', async () => {
      const abortController = new AbortController()
      abortController.abort()
      const cancelledContext = { ...mockContext, signal: abortController.signal }

      await expect(processor.convertToMarkdown(mockFile, mockConfig, cancelledContext)).rejects.toThrow(
        'Processing cancelled'
      )
    })

    it('should work without API key (optional)', async () => {
      const configWithoutKey = { ...mockConfig, apiKeys: undefined }

      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/zip' }),
        arrayBuffer: async () => new ArrayBuffer(100)
      } as Response)

      const result = await processor.convertToMarkdown(mockFile, configWithoutKey, mockContext)

      expect(assertMarkdownResult(result).markdownPath).toBeDefined()

      // Verify Authorization header is not set when no API key
      const fetchCall = vi.mocked(net.fetch).mock.calls[0]
      const options = fetchCall[1] as RequestInit
      const headers = options.headers as Record<string, string>
      expect(headers['Authorization']).toBeUndefined()
    })

    it('should include Authorization header when API key is provided', async () => {
      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/zip' }),
        arrayBuffer: async () => new ArrayBuffer(100)
      } as Response)

      await processor.convertToMarkdown(mockFile, mockConfig, mockContext)

      const fetchCall = vi.mocked(net.fetch).mock.calls[0]
      const options = fetchCall[1] as RequestInit
      const headers = options.headers as Record<string, string>
      expect(headers['Authorization']).toBe('Bearer test-api-key')
    })
  })

  describe('retry logic', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should retry on failure', async () => {
      // First attempt fails
      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable'
        } as Response)
        // Second attempt succeeds
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/zip' }),
          arrayBuffer: async () => new ArrayBuffer(100)
        } as Response)

      const promise = processor.convertToMarkdown(mockFile, mockConfig, mockContext)

      // Advance timer for retry delay
      await vi.advanceTimersByTimeAsync(5000)

      const result = await promise

      expect(assertMarkdownResult(result).markdownPath).toBeDefined()
      expect(vi.mocked(net.fetch)).toHaveBeenCalledTimes(2)
    })

    it('should stop retries when cancelled during backoff', async () => {
      vi.mocked(net.fetch).mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable'
      } as Response)

      const abortController = new AbortController()
      const cancelledContext = { ...mockContext, signal: abortController.signal }
      let capturedError: Error | undefined
      const promise = processor.convertToMarkdown(mockFile, mockConfig, cancelledContext).catch((error) => {
        capturedError = error as Error
      })

      await vi.waitFor(() => {
        expect(vi.mocked(net.fetch)).toHaveBeenCalledTimes(1)
      })

      abortController.abort()
      await vi.runAllTimersAsync()
      await promise

      expect(capturedError?.message).toBe('Processing cancelled')
      expect(vi.mocked(net.fetch)).toHaveBeenCalledTimes(1)
    })

    it('should cleanup ZIP file on retry', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      // First attempt fails after writing ZIP
      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'text/plain' }), // Wrong content type
          arrayBuffer: async () => new ArrayBuffer(100)
        } as Response)
        // Second attempt succeeds
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/zip' }),
          arrayBuffer: async () => new ArrayBuffer(100)
        } as Response)

      const promise = processor.convertToMarkdown(mockFile, mockConfig, mockContext)

      // Advance timer for retry delay
      await vi.advanceTimersByTimeAsync(5000)

      await promise

      // Verify cleanup was attempted
      expect(fs.unlinkSync).toHaveBeenCalled()
    })

    it('should throw after max retries', async () => {
      // All attempts fail
      vi.mocked(net.fetch).mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable'
      } as Response)

      // Store error for assertion - attach catch handler immediately to prevent unhandled rejection
      let capturedError: Error | undefined
      const promise = processor.convertToMarkdown(mockFile, mockConfig, mockContext).catch((e) => {
        capturedError = e as Error
      })

      // Run all timers to completion
      await vi.runAllTimersAsync()
      await promise

      expect(capturedError?.message).toContain('HTTP 503: Service Unavailable')

      // Should have tried 5 times (MAX_RETRIES)
      expect(vi.mocked(net.fetch)).toHaveBeenCalledTimes(5)
    })

    it('should log cleanup errors without throwing', async () => {
      // First attempt fails (HTTP 503), cleanup throws, second attempt succeeds
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        // Return true for readdirSync paths, false for zip paths initially
        return !String(path).includes('.zip')
      })

      // First attempt fails
      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable'
        } as Response)
        // Second attempt succeeds
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/zip' }),
          arrayBuffer: async () => new ArrayBuffer(100)
        } as Response)

      const promise = processor.convertToMarkdown(mockFile, mockConfig, mockContext)

      // Run all timers to completion
      await vi.runAllTimersAsync()

      // Should not throw despite cleanup error
      const result = await promise
      expect(assertMarkdownResult(result).markdownPath).toBeDefined()
    })
  })
})
