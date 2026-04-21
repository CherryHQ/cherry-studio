import { BaseService } from '@main/core/lifecycle'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { extractTextMock, startTaskMock, getTaskResultMock } = vi.hoisted(() => ({
  extractTextMock: vi.fn(),
  startTaskMock: vi.fn(),
  getTaskResultMock: vi.fn()
}))

vi.mock('@main/core/application', async () => {
  const { createMockApplication } = await import('@test-mocks/main/application')
  return {
    application: createMockApplication({
      MarkdownTaskService: {
        startTask: startTaskMock,
        getTaskResult: getTaskResultMock
      }
    } as any)
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

type RegisteredIpcHandler = (event: unknown, payload: unknown) => Promise<unknown>

describe('FileProcessingOrchestrationService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
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
    const ipcHandleSpy = vi.spyOn(service as any, 'ipcHandle').mockReturnValue({ dispose: vi.fn() })
    ;(service as any).onInit()

    const handlerCalls = ipcHandleSpy.mock.calls.map((call) => call[0])

    expect(handlerCalls).toEqual([
      'file-processing:extract-text',
      'file-processing:start-markdown-conversion-task',
      'file-processing:get-markdown-conversion-task-result'
    ])
  })

  it('validates extract-text IPC input before dispatching to OCR', async () => {
    const service = new FileProcessingOrchestrationService()
    const ipcHandleSpy = vi.spyOn(service as any, 'ipcHandle').mockReturnValue({ dispose: vi.fn() })
    ;(service as any).onInit()

    const extractTextHandler = ipcHandleSpy.mock.calls.find(
      (call) => call[0] === 'file-processing:extract-text'
    )?.[1] as RegisteredIpcHandler | undefined

    expect(extractTextHandler).toBeDefined()

    await expect(
      extractTextHandler!(
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
    const ipcHandleSpy = vi.spyOn(service as any, 'ipcHandle').mockReturnValue({ dispose: vi.fn() })
    ;(service as any).onInit()

    const getResultHandler = ipcHandleSpy.mock.calls.find(
      (call) => call[0] === 'file-processing:get-markdown-conversion-task-result'
    )?.[1] as RegisteredIpcHandler | undefined

    expect(getResultHandler).toBeDefined()

    await expect(getResultHandler!({}, { taskId: '   ' })).rejects.toThrow('[')
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
