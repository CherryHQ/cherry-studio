import { describe, expect, it, vi } from 'vitest'

const {
  startDocumentParsingMock,
  getDocumentParsingStatusMock,
  getDocumentParsingResultMock,
  startImageOcrMock,
  getImageOcrStatusMock,
  getImageOcrResultMock
} = vi.hoisted(() => ({
  startDocumentParsingMock: vi.fn(),
  getDocumentParsingStatusMock: vi.fn(),
  getDocumentParsingResultMock: vi.fn(),
  startImageOcrMock: vi.fn(),
  getImageOcrStatusMock: vi.fn(),
  getImageOcrResultMock: vi.fn()
}))

vi.mock('@main/services/paddleocr/PaddleOcrSdkService', () => ({
  paddleOcrSdkService: {
    startDocumentParsing: startDocumentParsingMock,
    getDocumentParsingStatus: getDocumentParsingStatusMock,
    getDocumentParsingResult: getDocumentParsingResultMock,
    startImageOcr: startImageOcrMock,
    getImageOcrStatus: getImageOcrStatusMock,
    getImageOcrResult: getImageOcrResultMock
  }
}))

import { FileInfoSchema } from '@shared/file/types'

import { paddleDocumentToMarkdownHandler } from '../document-to-markdown/handler'
import { paddleImageToTextHandler } from '../image-to-text/handler'

describe('paddle file-processing handlers', () => {
  it('starts document parsing through the shared paddle service', async () => {
    startDocumentParsingMock.mockResolvedValue({
      taskId: 'file-entry-1',
      providerTaskId: 'paddle-1',
      status: 'pending'
    })

    const prepared = await paddleDocumentToMarkdownHandler.prepare(
      FileInfoSchema.parse({
        path: '/tmp/a.pdf',
        name: 'a',
        ext: 'pdf',
        size: 1,
        mime: 'application/pdf',
        type: 'document',
        createdAt: 1,
        modifiedAt: 1
      }),
      {
        id: 'paddleocr',
        type: 'api',
        apiKeys: ['secret'],
        capabilities: [
          {
            feature: 'document_to_markdown',
            inputs: ['document'],
            output: 'markdown',
            apiHost: 'https://paddle.example.com',
            modelId: 'PP-StructureV3'
          }
        ]
      } as never,
      undefined,
      { fileEntryId: 'file-entry-1' as never }
    )

    expect(prepared.mode).toBe('remote-poll')

    const started = await prepared.startRemote()

    expect(startDocumentParsingMock).toHaveBeenCalledWith({
      taskId: 'file-entry-1',
      token: 'secret',
      baseUrl: 'https://paddle.example.com',
      filePath: '/tmp/a.pdf',
      model: 'PP-StructureV3',
      signal: undefined
    })
    expect(started).toEqual({
      providerTaskId: 'paddle-1',
      status: 'pending',
      progress: 0,
      remoteContext: {
        apiHost: 'https://paddle.example.com',
        apiKey: 'secret'
      }
    })
  })

  it('maps document-to-markdown poll states through the shared paddle service', async () => {
    getDocumentParsingStatusMock
      .mockResolvedValueOnce({
        taskId: 'job-1',
        providerTaskId: 'paddle-1',
        status: 'pending',
        progress: 0
      })
      .mockResolvedValueOnce({
        taskId: 'job-1',
        providerTaskId: 'paddle-1',
        status: 'processing',
        progress: 25
      })
      .mockResolvedValueOnce({
        taskId: 'job-1',
        providerTaskId: 'paddle-1',
        status: 'failed',
        progress: 0
      })
      .mockResolvedValueOnce({
        taskId: 'job-1',
        providerTaskId: 'paddle-1',
        status: 'completed',
        progress: 100
      })
    getDocumentParsingResultMock.mockResolvedValue({
      taskId: 'job-1',
      providerTaskId: 'paddle-1',
      status: 'completed',
      progress: 100,
      result: {
        markdown: '# output',
        pages: [{ markdown: '# output' }]
      }
    })

    const prepared = await paddleDocumentToMarkdownHandler.prepare(
      FileInfoSchema.parse({
        path: '/tmp/a.pdf',
        name: 'a',
        ext: 'pdf',
        size: 1,
        mime: 'application/pdf',
        type: 'document',
        createdAt: 1,
        modifiedAt: 1
      }),
      {
        id: 'paddleocr',
        type: 'api',
        apiKeys: ['secret'],
        capabilities: [
          {
            feature: 'document_to_markdown',
            inputs: ['document'],
            output: 'markdown',
            apiHost: 'https://paddle.example.com'
          }
        ]
      } as never,
      undefined,
      { fileEntryId: 'job-1' as never }
    )

    if (prepared.mode !== 'remote-poll') {
      throw new Error('Expected remote-poll prepared job')
    }

    await expect(
      prepared.pollRemote(
        {
          providerTaskId: 'paddle-1',
          remoteContext: {
            apiHost: 'https://paddle.example.com',
            apiKey: 'secret'
          }
        },
        undefined
      )
    ).resolves.toEqual({
      status: 'pending',
      progress: 0
    })

    await expect(
      prepared.pollRemote(
        {
          providerTaskId: 'paddle-1',
          remoteContext: {
            apiHost: 'https://paddle.example.com',
            apiKey: 'secret'
          }
        },
        undefined
      )
    ).resolves.toEqual({
      status: 'processing',
      progress: 25
    })

    await expect(
      prepared.pollRemote(
        {
          providerTaskId: 'paddle-1',
          remoteContext: {
            apiHost: 'https://paddle.example.com',
            apiKey: 'secret'
          }
        },
        undefined
      )
    ).resolves.toEqual({
      status: 'failed',
      error: 'PaddleOCR markdown conversion failed (providerTaskId=paddle-1)'
    })

    await expect(
      prepared.pollRemote(
        {
          providerTaskId: 'paddle-1',
          remoteContext: {
            apiHost: 'https://paddle.example.com',
            apiKey: 'secret'
          }
        },
        undefined
      )
    ).resolves.toEqual({
      status: 'completed',
      output: {
        kind: 'markdown',
        markdownContent: '# output'
      }
    })
  })

  it('starts image OCR through the shared paddle service and completes via remote-poll', async () => {
    startImageOcrMock.mockResolvedValue({
      taskId: 'image-entry-1',
      providerTaskId: 'paddle-2',
      status: 'pending'
    })
    getImageOcrStatusMock
      .mockResolvedValueOnce({
        taskId: 'image-entry-1',
        providerTaskId: 'paddle-2',
        status: 'processing',
        progress: 40
      })
      .mockResolvedValueOnce({
        taskId: 'image-entry-1',
        providerTaskId: 'paddle-2',
        status: 'completed',
        progress: 100
      })
    getImageOcrResultMock.mockResolvedValue({
      taskId: 'image-entry-1',
      providerTaskId: 'paddle-2',
      status: 'completed',
      progress: 100,
      result: {
        text: 'recognized text',
        pages: [{ text: 'recognized text' }]
      }
    })

    const prepared = await paddleImageToTextHandler.prepare(
      FileInfoSchema.parse({
        path: '/tmp/a.png',
        name: 'a',
        ext: 'png',
        size: 1,
        mime: 'image/png',
        type: 'image',
        createdAt: 1,
        modifiedAt: 1
      }),
      {
        id: 'paddleocr',
        type: 'api',
        apiKeys: ['secret'],
        capabilities: [
          {
            feature: 'image_to_text',
            inputs: ['image'],
            output: 'text',
            apiHost: 'https://paddle.example.com',
            modelId: 'PP-OCRv5'
          }
        ]
      } as never,
      undefined,
      { fileEntryId: 'image-entry-1' as never }
    )

    expect(prepared.mode).toBe('remote-poll')

    const started = await prepared.startRemote()

    expect(startImageOcrMock).toHaveBeenCalledWith({
      taskId: 'image-entry-1',
      token: 'secret',
      baseUrl: 'https://paddle.example.com',
      filePath: '/tmp/a.png',
      model: 'PP-OCRv5',
      signal: undefined
    })
    expect(started).toEqual({
      providerTaskId: 'paddle-2',
      status: 'pending',
      progress: 0,
      remoteContext: {
        apiHost: 'https://paddle.example.com',
        apiKey: 'secret'
      }
    })

    if (prepared.mode !== 'remote-poll') {
      throw new Error('Expected remote-poll prepared job')
    }

    await expect(
      prepared.pollRemote(
        {
          providerTaskId: 'paddle-2',
          remoteContext: {
            apiHost: 'https://paddle.example.com',
            apiKey: 'secret'
          }
        },
        undefined
      )
    ).resolves.toEqual({
      status: 'processing',
      progress: 40
    })

    await expect(
      prepared.pollRemote(
        {
          providerTaskId: 'paddle-2',
          remoteContext: {
            apiHost: 'https://paddle.example.com',
            apiKey: 'secret'
          }
        },
        undefined
      )
    ).resolves.toEqual({
      status: 'completed',
      output: {
        kind: 'text',
        text: 'recognized text'
      }
    })
  })

  it('keeps image OCR restricted to image files', () => {
    expect(() =>
      paddleImageToTextHandler.prepare(
        FileInfoSchema.parse({
          path: '/tmp/a.pdf',
          name: 'a',
          ext: 'pdf',
          size: 1,
          mime: 'application/pdf',
          type: 'document',
          createdAt: 1,
          modifiedAt: 1
        }),
        {
          id: 'paddleocr',
          type: 'api',
          apiKeys: ['secret'],
          capabilities: [
            {
              feature: 'image_to_text',
              inputs: ['image'],
              output: 'text',
              apiHost: 'https://paddle.example.com'
            }
          ]
        } as never
      )
    ).toThrow('PaddleOCR text extraction only supports image files')
  })
})
