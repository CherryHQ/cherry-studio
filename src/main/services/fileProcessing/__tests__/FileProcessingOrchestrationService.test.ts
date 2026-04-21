import type * as LifecycleModule from '@main/core/lifecycle'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, extractTextMock, startTaskMock, getTaskResultMock } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  extractTextMock: vi.fn(),
  startTaskMock: vi.fn(),
  getTaskResultMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: appGetMock
  }
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

vi.mock('../ocr/OcrService', () => ({
  ocrService: {
    extractText: extractTextMock
  }
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

    appGetMock.mockImplementation((serviceName: string) => {
      if (serviceName === 'MarkdownTaskService') {
        return {
          startTask: startTaskMock,
          getTaskResult: getTaskResultMock
        }
      }

      throw new Error(`Unexpected application.get(${serviceName}) in test`)
    })
  })

  it('uses WhenReady phase and waits for file-processing runtime services', () => {
    expect(getPhase(FileProcessingOrchestrationService)).toBe(Phase.WhenReady)
    expect(getDependencies(FileProcessingOrchestrationService)).toEqual([
      'MarkdownTaskService',
      'TesseractRuntimeService'
    ])
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

  it('validates extract-text IPC input before dispatching to OCR', async () => {
    const service = new FileProcessingOrchestrationService()
    ;(service as any).onInit()

    const extractTextHandler = ((service as any).ipcHandle as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === 'file-processing:extract-text'
    )?.[1]

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

    expect(extractTextMock).not.toHaveBeenCalled()
  })

  it('validates markdown-result IPC input before dispatching to markdown tasks', async () => {
    const service = new FileProcessingOrchestrationService()
    ;(service as any).onInit()

    const getResultHandler = ((service as any).ipcHandle as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === 'file-processing:get-markdown-conversion-task-result'
    )?.[1]

    await expect(getResultHandler?.({}, { taskId: '   ' })).rejects.toThrow('[')
    expect(getTaskResultMock).not.toHaveBeenCalled()
  })

  it('delegates OCR requests to ocrService', async () => {
    const signal = new AbortController().signal
    const service = new FileProcessingOrchestrationService()

    extractTextMock.mockResolvedValueOnce({
      text: 'hello'
    })

    await expect(service.extractText({ file: imageFile as never, signal })).resolves.toEqual({
      text: 'hello'
    })

    expect(extractTextMock).toHaveBeenCalledWith({
      file: imageFile,
      processorId: undefined,
      signal
    })
  })

  it('delegates markdown task start requests to MarkdownTaskService', async () => {
    const signal = new AbortController().signal
    const service = new FileProcessingOrchestrationService()

    startTaskMock.mockResolvedValueOnce({
      taskId: 'task-1',
      status: 'processing',
      progress: 0,
      processorId: 'open-mineru'
    })

    await expect(service.startMarkdownConversionTask({ file: documentFile as never, signal })).resolves.toEqual({
      taskId: 'task-1',
      status: 'processing',
      progress: 0,
      processorId: 'open-mineru'
    })

    expect(startTaskMock).toHaveBeenCalledWith({
      file: documentFile,
      processorId: undefined,
      signal
    })
  })

  it('delegates markdown task queries to MarkdownTaskService by taskId', async () => {
    const signal = new AbortController().signal
    const service = new FileProcessingOrchestrationService()

    getTaskResultMock.mockResolvedValueOnce({
      status: 'completed',
      progress: 100,
      processorId: 'doc2x',
      markdownPath: '/tmp/output.md'
    })

    await expect(
      service.getMarkdownConversionTaskResult({
        taskId: 'task-1',
        signal
      })
    ).resolves.toEqual({
      status: 'completed',
      progress: 100,
      processorId: 'doc2x',
      markdownPath: '/tmp/output.md'
    })

    expect(getTaskResultMock).toHaveBeenCalledWith({
      taskId: 'task-1',
      signal
    })
  })
})
