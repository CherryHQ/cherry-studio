import type * as LifecycleModule from '@main/core/lifecycle'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  preferenceGetMock,
  createTextExtractionProcessorMock,
  createMarkdownConversionProcessorMock,
  extractTextMock,
  startMarkdownConversionTaskMock,
  getMarkdownConversionTaskResultMock
} = vi.hoisted(() => ({
  preferenceGetMock: vi.fn(),
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

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')

  return mockApplicationFactory({
    PreferenceService: {
      get: preferenceGetMock
    }
  })
})

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
    preferenceGetMock.mockImplementation((key: string) => {
      if (key === 'feature.file_processing.default_text_extraction') {
        return 'tesseract'
      }

      if (key === 'feature.file_processing.default_markdown_conversion') {
        return 'open-mineru'
      }

      if (key === 'feature.file_processing.overrides') {
        return {}
      }

      return undefined
    })
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

  it('validates extract-text IPC input before dispatching to processors', async () => {
    const service = new FileProcessingOrchestrationService()
    ;(service as any).onInit()

    const extractTextHandler = ((service as any).ipcHandle as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === 'file-processing:extract-text'
    )?.[1]

    expect(extractTextHandler).toBeTypeOf('function')
    await expect(
      extractTextHandler?.(
        {},
        {
          file: {
            id: 'file-1'
          },
          processorId: 'tesseract'
        }
      )
    ).rejects.toThrow('[')
    expect(createTextExtractionProcessorMock).not.toHaveBeenCalled()
  })

  it('validates markdown-result IPC input before dispatching to processors', async () => {
    const service = new FileProcessingOrchestrationService()
    ;(service as any).onInit()

    const getResultHandler = ((service as any).ipcHandle as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === 'file-processing:get-markdown-conversion-task-result'
    )?.[1]

    expect(getResultHandler).toBeTypeOf('function')
    await expect(getResultHandler?.({}, { providerTaskId: '   ', processorId: 'doc2x' })).rejects.toThrow('[')
    expect(createMarkdownConversionProcessorMock).not.toHaveBeenCalled()
  })

  it('resolves text extraction config and forwards the request to the selected processor', async () => {
    const signal = new AbortController().signal
    const service = new FileProcessingOrchestrationService()

    preferenceGetMock.mockImplementation((key: string) => {
      if (key === 'feature.file_processing.default_text_extraction') {
        return 'tesseract'
      }

      if (key === 'feature.file_processing.overrides') {
        return {
          tesseract: {
            options: {
              langs: ['eng']
            }
          }
        }
      }

      return undefined
    })
    createTextExtractionProcessorMock.mockReturnValueOnce({
      extractText: extractTextMock
    })
    extractTextMock.mockResolvedValueOnce({
      text: 'hello'
    })

    await expect(service.extractText({ file: imageFile as never, signal })).resolves.toEqual({
      text: 'hello'
    })

    expect(createTextExtractionProcessorMock).toHaveBeenCalledWith('tesseract')
    expect(extractTextMock).toHaveBeenCalledWith(
      imageFile,
      expect.objectContaining({
        id: 'tesseract',
        options: {
          langs: ['eng']
        }
      }),
      signal
    )
  })

  it('starts markdown conversion with the resolved processor config only', async () => {
    const signal = new AbortController().signal
    const service = new FileProcessingOrchestrationService()

    preferenceGetMock.mockImplementation((key: string) => {
      if (key === 'feature.file_processing.default_markdown_conversion') {
        return 'open-mineru'
      }

      if (key === 'feature.file_processing.overrides') {
        return {
          'open-mineru': {
            apiKeys: ['secret-key'],
            capabilities: {
              markdown_conversion: {
                apiHost: 'http://127.0.0.1:8000'
              }
            }
          }
        }
      }

      return undefined
    })
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

    expect(createMarkdownConversionProcessorMock).toHaveBeenCalledWith('open-mineru')
    expect(startMarkdownConversionTaskMock).toHaveBeenCalledWith(
      documentFile,
      expect.objectContaining({
        id: 'open-mineru',
        apiKeys: ['secret-key']
      }),
      signal
    )
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

    expect(createMarkdownConversionProcessorMock).toHaveBeenCalledWith('doc2x')
    expect(getMarkdownConversionTaskResultMock).toHaveBeenCalledWith('provider-task-1', signal)
  })
})
