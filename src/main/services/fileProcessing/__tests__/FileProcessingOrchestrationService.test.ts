import type * as LifecycleModule from '@main/core/lifecycle'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  resolveProcessorConfigMock,
  createTextExtractionProcessorMock,
  createMarkdownConversionProcessorMock,
  extractTextMock,
  startMarkdownConversionTaskMock,
  getMarkdownConversionTaskResultMock
} = vi.hoisted(() => ({
  resolveProcessorConfigMock: vi.fn(),
  createTextExtractionProcessorMock: vi.fn(),
  createMarkdownConversionProcessorMock: vi.fn(),
  extractTextMock: vi.fn(),
  startMarkdownConversionTaskMock: vi.fn(),
  getMarkdownConversionTaskResultMock: vi.fn()
}))

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof LifecycleModule>()

  class MockBaseService {
    ipcHandle = vi.fn()
  }

  return {
    ...actual,
    BaseService: MockBaseService
  }
})

vi.mock('../config/resolveProcessorConfig', () => ({
  resolveProcessorConfig: resolveProcessorConfigMock
}))

vi.mock('../processors/factory', () => ({
  createTextExtractionProcessor: createTextExtractionProcessorMock,
  createMarkdownConversionProcessor: createMarkdownConversionProcessorMock
}))

const { FileProcessingOrchestrationService } = await import('../FileProcessingOrchestrationService')

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

describe('FileProcessingOrchestrationService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses WhenReady phase without init-time service dependencies', () => {
    expect(getPhase(FileProcessingOrchestrationService)).toBe(Phase.WhenReady)
    expect(getDependencies(FileProcessingOrchestrationService)).toEqual([])
  })

  it('registers the three file processing IPC handlers', () => {
    const service = new FileProcessingOrchestrationService()
    ;(service as any).onInit()

    const handlerCalls = ((service as any).ipcHandle as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0])

    expect(handlerCalls).toEqual([
      'file-processing:extract-text',
      'file-processing:start-markdown-conversion-task',
      'file-processing:get-markdown-conversion-task-result'
    ])
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
    const service = new FileProcessingOrchestrationService()

    resolveProcessorConfigMock.mockResolvedValueOnce(resolvedConfig)
    createTextExtractionProcessorMock.mockReturnValueOnce({
      extractText: extractTextMock
    })
    extractTextMock.mockResolvedValueOnce({
      text: 'hello'
    })

    await expect(service.extractText({ file: imageFile as never, signal })).resolves.toEqual({
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
    const service = new FileProcessingOrchestrationService()

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

    await expect(service.startMarkdownConversionTask({ file: documentFile as never, signal })).resolves.toEqual({
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
    const service = new FileProcessingOrchestrationService()

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
      service.getMarkdownConversionTaskResult({
        providerTaskId: 'provider-task-1',
        processorId: 'doc2x',
        signal
      })
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
})
