import fs from 'node:fs/promises'

import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import { type FileInfo, FileInfoSchema } from '@shared/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getStatusMock,
  submitDocumentParsingMock,
  waitDocumentParsingResultMock,
  ocrMock,
  netFetchMock,
  PaddleOCRClientMock
} = vi.hoisted(() => {
  const getStatusMock = vi.fn()
  const submitDocumentParsingMock = vi.fn()
  const waitDocumentParsingResultMock = vi.fn()
  const ocrMock = vi.fn()
  const netFetchMock = vi.fn()

  return {
    getStatusMock,
    submitDocumentParsingMock,
    waitDocumentParsingResultMock,
    ocrMock,
    netFetchMock,
    PaddleOCRClientMock: vi.fn(() => ({
      getStatus: getStatusMock,
      submitDocumentParsing: submitDocumentParsingMock,
      waitDocumentParsingResult: waitDocumentParsingResultMock,
      ocr: ocrMock
    }))
  }
})

vi.mock('@paddleocr/api-sdk', () => ({
  PaddleOCRClient: PaddleOCRClientMock
}))

vi.mock('electron', () => ({
  net: { fetch: netFetchMock }
}))

import { buildPollResult, paddleDocumentToMarkdownHandler } from '../document-to-markdown/handler'
import { paddleImageToTextHandler } from '../image-to-text/handler'

const documentFile = FileInfoSchema.parse({
  path: '/tmp/input.pdf',
  name: 'input',
  size: 1024,
  ext: 'pdf',
  mime: 'application/pdf',
  type: 'document',
  createdAt: 1,
  modifiedAt: 1
}) as FileInfo

const imageFile = FileInfoSchema.parse({
  path: '/tmp/input.png',
  name: 'input',
  size: 1024,
  ext: 'png',
  mime: 'image/png',
  type: 'image',
  createdAt: 1,
  modifiedAt: 1
}) as FileInfo

function createConfig(feature: 'image_to_text' | 'document_to_markdown', modelId: string): FileProcessorMerged {
  return {
    id: 'paddleocr',
    type: 'api',
    apiKeys: ['secret-key'],
    capabilities: [
      {
        feature,
        inputs: [feature === 'image_to_text' ? 'image' : 'document'],
        output: feature === 'image_to_text' ? 'text' : 'markdown',
        apiHost: 'https://paddleocr.aistudio-app.com/',
        modelId
      }
    ]
  } as FileProcessorMerged
}

describe('paddleocr handlers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.spyOn(fs, 'stat').mockResolvedValue({ size: 1024 } as never)
  })

  it('extracts text from images when configured with an OCR model', async () => {
    const prepared = await paddleImageToTextHandler.prepare(imageFile, createConfig('image_to_text', 'PP-OCRv6'))
    if (prepared.mode !== 'background') {
      throw new Error('Expected paddle image handler to prepare a background task')
    }

    ocrMock.mockResolvedValueOnce({
      pages: [{ prunedResult: { rec_texts: ['hello', 'world'] } }]
    })

    await expect(
      prepared.execute({
        signal: new AbortController().signal,
        reportProgress: vi.fn()
      })
    ).resolves.toEqual({ kind: 'text', text: 'hello\nworld' })
  })

  it('fails when image OCR returns empty text content', async () => {
    const prepared = await paddleImageToTextHandler.prepare(imageFile, createConfig('image_to_text', 'PP-OCRv6'))
    if (prepared.mode !== 'background') {
      throw new Error('Expected paddle image handler to prepare a background task')
    }

    ocrMock.mockResolvedValueOnce({
      pages: [{ prunedResult: { rec_texts: ['   ', ''] } }]
    })

    await expect(
      prepared.execute({
        signal: new AbortController().signal,
        reportProgress: vi.fn()
      })
    ).rejects.toThrow('PaddleOCR image OCR returned empty text content')
  })

  it('fails when a completed document parsing job returns empty markdown', async () => {
    getStatusMock.mockResolvedValueOnce({ state: 'done' })
    waitDocumentParsingResultMock.mockResolvedValueOnce({
      pages: [{ markdownText: '   ' }, { markdownText: '' }]
    })

    await expect(
      buildPollResult('job-1', { apiHost: 'https://paddleocr.aistudio-app.com/', apiKey: 'secret-key' })
    ).resolves.toEqual({
      status: 'failed',
      error: 'PaddleOCR task job-1 completed but returned empty markdown content'
    })
  })

  it('rejects image OCR requests larger than 50MB before upload', async () => {
    vi.spyOn(fs, 'stat').mockResolvedValueOnce({ size: 51 * 1024 * 1024 } as never)

    await expect(
      paddleImageToTextHandler.prepare(imageFile, createConfig('image_to_text', 'PP-OCRv6'))
    ).rejects.toThrow('PaddleOCR file is too large (must be smaller than 50MB)')
  })

  it('rejects document parsing requests larger than 50MB before upload', async () => {
    vi.spyOn(fs, 'stat').mockResolvedValueOnce({ size: 51 * 1024 * 1024 } as never)

    const prepared = await paddleDocumentToMarkdownHandler.prepare(
      documentFile,
      createConfig('document_to_markdown', 'PaddleOCR-VL-1.5')
    )
    if (prepared.mode !== 'remote-poll') {
      throw new Error('Expected paddle document handler to prepare a remote-poll task')
    }

    await expect(prepared.startRemote(new AbortController().signal)).rejects.toThrow(
      'PaddleOCR file is too large (must be smaller than 50MB)'
    )
  })

  it('resumes document polling after restart without reading the local file', async () => {
    vi.spyOn(fs, 'stat').mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    await expect(
      paddleDocumentToMarkdownHandler.prepare(documentFile, createConfig('document_to_markdown', 'PaddleOCR-VL-1.5'))
    ).resolves.toMatchObject({ mode: 'remote-poll' })
  })

  it('starts remote document parsing with the configured model', async () => {
    const prepared = await paddleDocumentToMarkdownHandler.prepare(
      documentFile,
      createConfig('document_to_markdown', 'PaddleOCR-VL-1.5')
    )
    if (prepared.mode !== 'remote-poll') {
      throw new Error('Expected paddle document handler to prepare a remote-poll task')
    }

    submitDocumentParsingMock.mockResolvedValueOnce({ jobId: 'job-1' })

    await expect(prepared.startRemote(new AbortController().signal)).resolves.toEqual({
      providerTaskId: 'job-1',
      status: 'pending',
      progress: 0,
      remoteContext: {
        apiHost: 'https://paddleocr.aistudio-app.com',
        apiKey: 'secret-key'
      }
    })

    expect(submitDocumentParsingMock).toHaveBeenCalledWith(
      { filePath: '/tmp/input.pdf', model: 'PaddleOCR-VL-1.5' },
      { signal: expect.any(AbortSignal) }
    )
  })

  it('persists only the public apiHost for remote-poll paddleocr jobs', async () => {
    const prepared = await paddleDocumentToMarkdownHandler.prepare(
      documentFile,
      createConfig('document_to_markdown', 'PaddleOCR-VL-1.5')
    )
    if (prepared.mode !== 'remote-poll') {
      throw new Error('Expected paddle document handler to prepare a remote-poll task')
    }

    expect(
      prepared.toPersistable({ apiHost: 'https://paddleocr.aistudio-app.com/', apiKey: 'secret-key' }, 'job-1')
    ).toEqual({
      providerTaskId: 'job-1',
      apiHost: 'https://paddleocr.aistudio-app.com/'
    })
  })

  it('rehydrates apiKey from restored config', async () => {
    const prepared = await paddleDocumentToMarkdownHandler.prepare(
      documentFile,
      createConfig('document_to_markdown', 'PaddleOCR-VL-1.5')
    )
    if (prepared.mode !== 'remote-poll') {
      throw new Error('Expected paddle document handler to prepare a remote-poll task')
    }

    expect(
      prepared.rehydrate(
        {
          providerTaskId: 'job-1',
          apiHost: 'https://paddleocr.aistudio-app.com/'
        },
        createConfig('document_to_markdown', 'PaddleOCR-VL-1.5')
      )
    ).toEqual({
      providerTaskId: 'job-1',
      remoteContext: {
        apiHost: 'https://paddleocr.aistudio-app.com/',
        apiKey: 'secret-key'
      }
    })
  })

  it('rejects rehydrate when persisted apiHost is missing', async () => {
    const prepared = await paddleDocumentToMarkdownHandler.prepare(
      documentFile,
      createConfig('document_to_markdown', 'PaddleOCR-VL-1.5')
    )
    if (prepared.mode !== 'remote-poll') {
      throw new Error('Expected paddle document handler to prepare a remote-poll task')
    }

    expect(() =>
      prepared.rehydrate(
        {
          providerTaskId: 'job-1',
          apiHost: ''
        },
        createConfig('document_to_markdown', 'PaddleOCR-VL-1.5')
      )
    ).toThrow('paddleocr rehydrate: missing apiHost in persisted remote state')
  })

  it('sanitizes image OCR result fetches and forbids redirects during the real ocr flow', async () => {
    PaddleOCRClientMock.mockImplementationOnce((options?: { fetch?: typeof fetch }) => {
      const safeFetch = options?.fetch
      if (!safeFetch) {
        throw new Error('Expected PaddleOCR client to receive a fetch implementation')
      }

      ocrMock.mockImplementationOnce(async () => {
        void safeFetch('https://paddleocr.aistudio-app.com/results/job-1', { method: 'GET' })
        return safeFetch('http://127.0.0.1/results/job-1', { method: 'GET' }) as never
      })

      return {
        getStatus: getStatusMock,
        submitDocumentParsing: submitDocumentParsingMock,
        waitDocumentParsingResult: waitDocumentParsingResultMock,
        ocr: ocrMock
      }
    })

    netFetchMock.mockResolvedValue({ ok: true } as never)

    const prepared = await paddleImageToTextHandler.prepare(imageFile, createConfig('image_to_text', 'PP-OCRv6'))
    if (prepared.mode !== 'background') {
      throw new Error('Expected paddle image handler to prepare a background task')
    }

    await expect(
      prepared.execute({
        signal: new AbortController().signal,
        reportProgress: vi.fn()
      })
    ).rejects.toThrow('Unsafe remote url: local or private addresses are not allowed (127.0.0.1)')

    expect(ocrMock).toHaveBeenCalledTimes(1)
    expect(netFetchMock).toHaveBeenCalledWith('https://paddleocr.aistudio-app.com/results/job-1', {
      method: 'GET',
      redirect: 'error'
    })
  })

  it('returns failed status when PaddleOCR reports a failed document job', async () => {
    getStatusMock.mockResolvedValueOnce({ state: 'failed', errorMsg: 'provider failed' })

    await expect(
      buildPollResult('job-1', { apiHost: 'https://paddleocr.aistudio-app.com/', apiKey: 'secret-key' })
    ).resolves.toEqual({
      status: 'failed',
      error: 'provider failed'
    })
  })

  it('returns completed markdown when a document parsing job succeeds', async () => {
    getStatusMock.mockResolvedValueOnce({ state: 'done' })
    waitDocumentParsingResultMock.mockResolvedValueOnce({
      pages: [{ markdownText: '# Title' }, { markdownText: 'Body' }]
    })

    await expect(
      buildPollResult('job-1', { apiHost: 'https://paddleocr.aistudio-app.com/', apiKey: 'secret-key' })
    ).resolves.toEqual({
      status: 'completed',
      output: { kind: 'markdown', markdownContent: '# Title\n\nBody' }
    })
  })

  it('returns pending status with zero progress before page counts are known', async () => {
    getStatusMock.mockResolvedValueOnce({ state: 'pending' })

    await expect(
      buildPollResult('job-1', { apiHost: 'https://paddleocr.aistudio-app.com/', apiKey: 'secret-key' })
    ).resolves.toEqual({
      status: 'pending',
      progress: 0
    })
  })

  it('returns processing status with mapped progress for active document jobs', async () => {
    getStatusMock.mockResolvedValueOnce({ state: 'running', progress: { extractedPages: 1, totalPages: 2 } })

    await expect(
      buildPollResult('job-1', { apiHost: 'https://paddleocr.aistudio-app.com/', apiKey: 'secret-key' })
    ).resolves.toEqual({
      status: 'processing',
      progress: 50
    })
  })

  it('sanitizes document result fetches and forbids redirects during the real done flow', async () => {
    PaddleOCRClientMock.mockImplementationOnce((options?: { fetch?: typeof fetch }) => {
      const safeFetch = options?.fetch
      if (!safeFetch) {
        throw new Error('Expected PaddleOCR client to receive a fetch implementation')
      }

      waitDocumentParsingResultMock.mockImplementationOnce(async () => {
        void safeFetch('https://paddleocr.aistudio-app.com/results/job-1', { method: 'GET' })
        return safeFetch('http://127.0.0.1/results/job-1', { method: 'GET' }) as never
      })

      return {
        getStatus: getStatusMock,
        submitDocumentParsing: vi.fn(),
        waitDocumentParsingResult: waitDocumentParsingResultMock,
        ocr: ocrMock
      }
    })

    netFetchMock.mockResolvedValue({ ok: true } as never)
    getStatusMock.mockResolvedValueOnce({ state: 'done' })

    await expect(
      buildPollResult('job-1', { apiHost: 'https://paddleocr.aistudio-app.com/', apiKey: 'secret-key' })
    ).rejects.toThrow('Unsafe remote url: local or private addresses are not allowed (127.0.0.1)')

    expect(getStatusMock).toHaveBeenCalledTimes(1)
    expect(waitDocumentParsingResultMock).toHaveBeenCalledTimes(1)
    expect(netFetchMock).toHaveBeenCalledWith('https://paddleocr.aistudio-app.com/results/job-1', {
      method: 'GET',
      redirect: 'error'
    })
  })
})
