import fs from 'node:fs/promises'

import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { MistralMock, deleteMock, getSignedUrlMock, ocrProcessMock, uploadMock } = vi.hoisted(() => {
  const uploadMock = vi.fn()
  const getSignedUrlMock = vi.fn()
  const deleteMock = vi.fn()
  const ocrProcessMock = vi.fn()

  return {
    uploadMock,
    getSignedUrlMock,
    deleteMock,
    ocrProcessMock,
    MistralMock: vi.fn(() => ({
      files: {
        upload: uploadMock,
        getSignedUrl: getSignedUrlMock,
        delete: deleteMock
      },
      ocr: {
        process: ocrProcessMock
      }
    }))
  }
})

vi.mock('@mistralai/mistralai', () => ({
  Mistral: MistralMock
}))

import { mistralDocumentToMarkdownHandler } from '../handler'

describe('mistralDocumentToMarkdownHandler', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('pdf-data'))
    uploadMock.mockResolvedValue({ id: 'uploaded-file-1' })
    getSignedUrlMock.mockResolvedValue({ url: 'https://signed.example.com/input.pdf' })
    deleteMock.mockResolvedValue({})
    ocrProcessMock.mockResolvedValue({
      model: 'mistral-ocr-latest',
      pages: [{ markdown: '# Page 1' }, { markdown: 'Page 2' }]
    })
  })

  it('converts an uploaded document to markdown and deletes the uploaded file', async () => {
    const preparedTask = await mistralDocumentToMarkdownHandler.prepare(createFile(), createConfig())
    expect(preparedTask.mode).toBe('background')
    if (preparedTask.mode !== 'background') {
      throw new Error('Expected Mistral document handler to prepare a background task')
    }

    const progress: number[] = []
    const output = await preparedTask.execute({
      signal: new AbortController().signal,
      reportProgress: (value) => progress.push(value)
    })

    expect(MistralMock).toHaveBeenCalledWith({
      apiKey: 'secret-key',
      serverURL: 'https://api.mistral.ai'
    })
    expect(uploadMock).toHaveBeenCalledWith(
      {
        file: {
          fileName: 'input.pdf',
          content: new Uint8Array(Buffer.from('pdf-data'))
        },
        purpose: 'ocr'
      },
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    )
    expect(getSignedUrlMock).toHaveBeenCalledWith(
      {
        fileId: 'uploaded-file-1'
      },
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    )
    expect(ocrProcessMock).toHaveBeenCalledWith(
      {
        model: 'mistral-ocr-latest',
        document: {
          type: 'document_url',
          documentUrl: 'https://signed.example.com/input.pdf'
        },
        tableFormat: 'html',
        includeImageBase64: false
      },
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    )
    expect(deleteMock).toHaveBeenCalledWith(
      {
        fileId: 'uploaded-file-1'
      },
      {
        signal: undefined
      }
    )
    expect(output).toEqual({
      kind: 'markdown',
      markdownContent: '# Page 1\n\nPage 2'
    })
    expect(progress).toEqual([10, 35, 45, 85, 95])
  })

  it('uses a fresh cleanup request when the task signal was aborted after upload', async () => {
    const controller = new AbortController()
    ocrProcessMock.mockImplementationOnce(() => {
      controller.abort()
      throw new Error('ocr failed')
    })
    const preparedTask = await mistralDocumentToMarkdownHandler.prepare(createFile(), createConfig())
    if (preparedTask.mode !== 'background') {
      throw new Error('Expected Mistral document handler to prepare a background task')
    }

    await expect(
      preparedTask.execute({
        signal: controller.signal,
        reportProgress: vi.fn()
      })
    ).rejects.toThrow('ocr failed')

    expect(deleteMock).toHaveBeenCalledWith(
      {
        fileId: 'uploaded-file-1'
      },
      {
        signal: undefined
      }
    )
  })

  it('deletes the uploaded file when OCR fails', async () => {
    ocrProcessMock.mockRejectedValueOnce(new Error('ocr failed'))
    const preparedTask = await mistralDocumentToMarkdownHandler.prepare(createFile(), createConfig())
    if (preparedTask.mode !== 'background') {
      throw new Error('Expected Mistral document handler to prepare a background task')
    }

    await expect(
      preparedTask.execute({
        signal: new AbortController().signal,
        reportProgress: vi.fn()
      })
    ).rejects.toThrow('ocr failed')

    expect(deleteMock).toHaveBeenCalledWith(
      {
        fileId: 'uploaded-file-1'
      },
      {
        signal: undefined
      }
    )
  })
})

function createConfig(): FileProcessorMerged {
  return {
    id: 'mistral',
    type: 'api',
    apiKeys: ['secret-key'],
    capabilities: [
      {
        feature: 'document_to_markdown',
        inputs: ['document'],
        output: 'markdown',
        apiHost: 'https://api.mistral.ai',
        modelId: 'mistral-ocr-latest'
      }
    ]
  }
}

function createFile(): FileMetadata {
  return {
    id: 'file-1',
    name: 'input.pdf',
    origin_name: 'input.pdf',
    path: '/tmp/input.pdf',
    size: 1024,
    ext: '.pdf',
    type: 'document',
    created_at: '2026-05-05T00:00:00.000Z',
    count: 1
  }
}
