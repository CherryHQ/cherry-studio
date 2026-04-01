import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  resolveProcessorConfigMock,
  getFilesDirMock,
  pathExistsMock,
  createTextExtractionProcessorMock,
  createMarkdownConversionProcessorMock,
  extractTextMock,
  startMarkdownConversionTaskMock,
  getMarkdownConversionTaskResultMock
} = vi.hoisted(() => ({
  resolveProcessorConfigMock: vi.fn(),
  getFilesDirMock: vi.fn(() => '/files'),
  pathExistsMock: vi.fn(),
  createTextExtractionProcessorMock: vi.fn(),
  createMarkdownConversionProcessorMock: vi.fn(),
  extractTextMock: vi.fn(),
  startMarkdownConversionTaskMock: vi.fn(),
  getMarkdownConversionTaskResultMock: vi.fn()
}))

vi.mock('../utils/config', () => ({
  resolveProcessorConfig: resolveProcessorConfigMock
}))

vi.mock('@main/utils/file', () => ({
  getFilesDir: getFilesDirMock,
  pathExists: pathExistsMock
}))

vi.mock('../providers/factory', () => ({
  createTextExtractionProcessor: createTextExtractionProcessorMock,
  createMarkdownConversionProcessor: createMarkdownConversionProcessorMock
}))

import { fileProcessingFacade } from '../FileProcessingFacade'

const imageFile = {
  id: 'file-1',
  name: 'scan.png',
  origin_name: 'scan.png',
  path: '/tmp/scan.png',
  size: 128,
  ext: '.png',
  type: 'image',
  created_at: '2026-03-31T00:00:00.000Z',
  count: 1
} as const

const documentFile = {
  id: 'file-2',
  name: 'report.pdf',
  origin_name: 'report.pdf',
  path: '/tmp/report.pdf',
  size: 512,
  ext: '.pdf',
  type: 'document',
  created_at: '2026-03-31T00:00:00.000Z',
  count: 1
} as const

describe('fileProcessingFacade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pathExistsMock.mockResolvedValue(false)
  })

  it('resolves text extraction config and forwards the request to the selected processor', async () => {
    const signal = new AbortController().signal
    const resolvedConfig = {
      id: 'tesseract',
      type: 'builtin',
      capabilities: [
        {
          feature: 'text_extraction',
          inputs: ['image'],
          output: 'text'
        }
      ]
    }

    resolveProcessorConfigMock.mockResolvedValueOnce(resolvedConfig)
    createTextExtractionProcessorMock.mockReturnValueOnce({
      extractText: extractTextMock
    })
    extractTextMock.mockResolvedValueOnce({
      text: 'hello'
    })

    await expect(fileProcessingFacade.extractText(imageFile as never, undefined, signal)).resolves.toEqual({
      text: 'hello'
    })

    expect(resolveProcessorConfigMock).toHaveBeenCalledWith('text_extraction', undefined)
    expect(createTextExtractionProcessorMock).toHaveBeenCalledWith('tesseract')
    expect(extractTextMock).toHaveBeenCalledWith(imageFile, resolvedConfig, signal)
  })

  it('starts markdown conversion with the resolved processor config only', async () => {
    const signal = new AbortController().signal
    const resolvedConfig = {
      id: 'open-mineru',
      type: 'api',
      capabilities: [
        {
          feature: 'markdown_conversion',
          inputs: ['document'],
          output: 'markdown',
          apiHost: 'http://127.0.0.1:8000'
        }
      ]
    }

    resolveProcessorConfigMock.mockResolvedValueOnce(resolvedConfig)
    createMarkdownConversionProcessorMock.mockReturnValueOnce({
      startMarkdownConversionTask: startMarkdownConversionTaskMock
    })
    startMarkdownConversionTaskMock.mockResolvedValueOnce({
      providerTaskId: 'task-1',
      status: 'processing',
      progress: 0,
      processorId: 'open-mineru'
    })

    await expect(
      fileProcessingFacade.startMarkdownConversionTask(documentFile as never, undefined, signal)
    ).resolves.toEqual({
      providerTaskId: 'task-1',
      status: 'processing',
      progress: 0,
      processorId: 'open-mineru'
    })

    expect(resolveProcessorConfigMock).toHaveBeenCalledWith('markdown_conversion', undefined)
    expect(createMarkdownConversionProcessorMock).toHaveBeenCalledWith('open-mineru')
    expect(startMarkdownConversionTaskMock).toHaveBeenCalledWith(documentFile, resolvedConfig, signal)
  })

  it('queries markdown conversion result directly from the requested processor id', async () => {
    const signal = new AbortController().signal

    createMarkdownConversionProcessorMock.mockReturnValueOnce({
      getMarkdownConversionTaskResult: getMarkdownConversionTaskResultMock
    })
    getMarkdownConversionTaskResultMock.mockResolvedValueOnce({
      status: 'completed',
      progress: 100,
      processorId: 'doc2x',
      markdownPath: '/tmp/output.md'
    })

    await expect(
      fileProcessingFacade.getMarkdownConversionTaskResult('provider-task-1', 'doc2x', signal)
    ).resolves.toEqual({
      status: 'completed',
      progress: 100,
      processorId: 'doc2x',
      markdownPath: '/tmp/output.md'
    })

    expect(resolveProcessorConfigMock).not.toHaveBeenCalled()
    expect(createMarkdownConversionProcessorMock).toHaveBeenCalledWith('doc2x')
    expect(getMarkdownConversionTaskResultMock).toHaveBeenCalledWith('provider-task-1', signal)
  })

  it('reads the persisted markdown result by file id', async () => {
    pathExistsMock.mockResolvedValueOnce(true)

    await expect(fileProcessingFacade.getPersistedMarkdownResult('file-2')).resolves.toBe(
      '/files/file-2/file-processing/output.md'
    )

    expect(pathExistsMock).toHaveBeenCalledWith('/files/file-2/file-processing/output.md')
  })

  it('returns undefined when the persisted markdown result is not available', async () => {
    pathExistsMock.mockResolvedValueOnce(false)

    await expect(fileProcessingFacade.getPersistedMarkdownResult('file-2')).resolves.toBeUndefined()
  })
})
