import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const getFilePathByIdMock = vi.hoisted(() => vi.fn())
const startDocumentParsingMock = vi.hoisted(() => vi.fn())
const getDocumentParsingStatusMock = vi.hoisted(() => vi.fn())
const getDocumentParsingResultMock = vi.hoisted(() => vi.fn())

vi.mock('@main/services/FileStorage', () => ({
  fileStorage: {
    getFilePathById: getFilePathByIdMock
  }
}))

vi.mock('@main/services/paddleocr/PaddleOcrSdkService', () => ({
  paddleOcrSdkService: {
    startDocumentParsing: startDocumentParsingMock,
    getDocumentParsingStatus: getDocumentParsingStatusMock,
    getDocumentParsingResult: getDocumentParsingResultMock
  }
}))

import { application } from '@application'

import PaddleocrPreprocessProvider from '../PaddleocrPreprocessProvider'

describe('PaddleocrPreprocessProvider', () => {
  let tempDir: string
  let pdfPath: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'paddleocr-preprocess-'))
    pdfPath = path.join(tempDir, 'input.pdf')
    await fs.promises.writeFile(pdfPath, Buffer.from('%PDF-1.4 mock pdf'))

    getFilePathByIdMock.mockReset()
    startDocumentParsingMock.mockReset()
    getDocumentParsingStatusMock.mockReset()
    getDocumentParsingResultMock.mockReset()

    getFilePathByIdMock.mockReturnValue(pdfPath)

    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.preprocess.temp') {
        return filename ? path.join(tempDir, filename) : tempDir
      }
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('submits, polls, saves markdown, and broadcasts progress for async Paddle preprocessing', async () => {
    startDocumentParsingMock.mockResolvedValue({
      taskId: 'source-1',
      providerTaskId: 'provider-task-1',
      status: 'pending'
    })
    getDocumentParsingStatusMock
      .mockResolvedValueOnce({
        taskId: 'source-1',
        providerTaskId: 'provider-task-1',
        status: 'processing',
        progress: 40
      })
      .mockResolvedValueOnce({
        taskId: 'source-1',
        providerTaskId: 'provider-task-1',
        status: 'completed',
        progress: 100
      })
    getDocumentParsingResultMock.mockResolvedValue({
      taskId: 'source-1',
      providerTaskId: 'provider-task-1',
      status: 'completed',
      progress: 100,
      result: {
        markdown: '# Page 1\n\n## Page 2',
        pages: [{ markdown: '# Page 1' }, { markdown: '## Page 2' }]
      }
    })

    const provider = new PaddleocrPreprocessProvider(
      {
        id: 'paddleocr',
        name: 'PaddleOCR',
        apiHost: 'https://paddle.example.com',
        apiKey: 'secret',
        model: 'PP-StructureV3'
      },
      'user-1'
    )

    vi.spyOn(provider, 'readPdf').mockResolvedValue({ numPages: 2 })
    vi.spyOn(provider, 'delay').mockResolvedValue(undefined)

    const processed = await provider.parseFile('source-1', {
      id: 'file-1',
      name: 'input.pdf',
      origin_name: 'input.pdf',
      path: pdfPath,
      size: 10,
      ext: '.pdf',
      type: 'document',
      created_at: new Date().toISOString(),
      count: 1
    })

    expect(startDocumentParsingMock).toHaveBeenCalledWith({
      taskId: 'source-1',
      token: 'secret',
      baseUrl: 'https://paddle.example.com',
      filePath: pdfPath,
      model: 'PP-StructureV3'
    })
    expect(getDocumentParsingStatusMock).toHaveBeenCalledTimes(2)
    expect(getDocumentParsingResultMock).toHaveBeenCalledWith({
      taskId: 'source-1',
      providerTaskId: 'provider-task-1',
      token: 'secret',
      baseUrl: 'https://paddle.example.com'
    })

    const outputPath = path.join(tempDir, 'file-1', 'input.md')
    await expect(fs.promises.readFile(outputPath, 'utf-8')).resolves.toBe('# Page 1\n\n## Page 2')
    expect(processed.processedFile.path).toBe(outputPath)
    expect(processed.processedFile.name).toBe('input.md')

    const windowManager = application.get('WindowManager') as {
      broadcastToType: ReturnType<typeof vi.fn>
    }
    expect(windowManager.broadcastToType).toHaveBeenNthCalledWith(1, 'main', 'file-preprocess-progress', {
      itemId: 'source-1',
      progress: 25
    })
    expect(windowManager.broadcastToType).toHaveBeenNthCalledWith(2, 'main', 'file-preprocess-progress', {
      itemId: 'source-1',
      progress: 55
    })
    expect(windowManager.broadcastToType).toHaveBeenNthCalledWith(3, 'main', 'file-preprocess-progress', {
      itemId: 'source-1',
      progress: 100
    })
  })

  it('fails when Paddle returns empty markdown', async () => {
    startDocumentParsingMock.mockResolvedValue({
      taskId: 'source-1',
      providerTaskId: 'provider-task-1',
      status: 'pending'
    })
    getDocumentParsingStatusMock.mockResolvedValue({
      taskId: 'source-1',
      providerTaskId: 'provider-task-1',
      status: 'completed',
      progress: 100
    })
    getDocumentParsingResultMock.mockResolvedValue({
      taskId: 'source-1',
      providerTaskId: 'provider-task-1',
      status: 'completed',
      progress: 100,
      result: {
        markdown: '   ',
        pages: []
      }
    })

    const provider = new PaddleocrPreprocessProvider({
      id: 'paddleocr',
      name: 'PaddleOCR',
      apiHost: 'https://paddle.example.com',
      apiKey: 'secret'
    })

    vi.spyOn(provider, 'readPdf').mockResolvedValue({ numPages: 1 })

    await expect(
      provider.parseFile('source-1', {
        id: 'file-1',
        name: 'input.pdf',
        origin_name: 'input.pdf',
        path: pdfPath,
        size: 10,
        ext: '.pdf',
        type: 'document',
        created_at: new Date().toISOString(),
        count: 1
      })
    ).rejects.toThrow(`PaddleOCR returned empty markdown content for file ${pdfPath}`)
  })
})
