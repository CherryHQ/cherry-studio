import { BaseService } from '@main/core/lifecycle'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { startTaskMock, getTaskMock, cancelTaskMock, listAvailableProcessorIdsMock } = vi.hoisted(() => ({
  startTaskMock: vi.fn(),
  getTaskMock: vi.fn(),
  cancelTaskMock: vi.fn(),
  listAvailableProcessorIdsMock: vi.fn()
}))

vi.mock('@main/core/application', async () => {
  const { createMockApplication } = await import('@test-mocks/main/application')
  return {
    application: createMockApplication({
      FileProcessingTaskService: {
        startTask: startTaskMock,
        getTask: getTaskMock,
        cancelTask: cancelTaskMock,
        listAvailableProcessorIds: listAvailableProcessorIdsMock
      }
    } as any)
  }
})

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

type RegisteredIpcHandler = (event: unknown, payload: unknown) => Promise<unknown>

describe('FileProcessingOrchestrationService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
  })

  it('uses WhenReady phase and waits for the task service', () => {
    expect(getPhase(FileProcessingOrchestrationService)).toBe(Phase.WhenReady)
    expect(getDependencies(FileProcessingOrchestrationService)).toEqual(['FileProcessingTaskService'])
  })

  it('registers the unified file processing IPC handlers', () => {
    const service = new FileProcessingOrchestrationService()
    const ipcHandleSpy = vi.spyOn(service as any, 'ipcHandle').mockReturnValue({ dispose: vi.fn() })
    ;(service as any).onInit()

    const handlerCalls = ipcHandleSpy.mock.calls.map((call) => call[0])

    expect(handlerCalls).toEqual([
      'file-processing:start-task',
      'file-processing:get-task',
      'file-processing:cancel-task',
      'file-processing:list-available-processors'
    ])
  })

  it('validates start-task IPC input before delegating', async () => {
    const service = new FileProcessingOrchestrationService()
    const ipcHandleSpy = vi.spyOn(service as any, 'ipcHandle').mockReturnValue({ dispose: vi.fn() })
    ;(service as any).onInit()

    const startTaskHandler = ipcHandleSpy.mock.calls.find((call) => call[0] === 'file-processing:start-task')?.[1] as
      | RegisteredIpcHandler
      | undefined

    expect(startTaskHandler).toBeDefined()

    await expect(
      startTaskHandler!(
        {},
        {
          feature: 'image_to_text',
          file: {
            id: 'file-1'
          },
          processorId: 'tesseract'
        }
      )
    ).rejects.toThrow('[')

    expect(startTaskMock).not.toHaveBeenCalled()
  })

  it('validates get-task IPC input before delegating', async () => {
    const service = new FileProcessingOrchestrationService()
    const ipcHandleSpy = vi.spyOn(service as any, 'ipcHandle').mockReturnValue({ dispose: vi.fn() })
    ;(service as any).onInit()

    const getTaskHandler = ipcHandleSpy.mock.calls.find((call) => call[0] === 'file-processing:get-task')?.[1] as
      | RegisteredIpcHandler
      | undefined

    expect(getTaskHandler).toBeDefined()

    await expect(getTaskHandler!({}, { taskId: '   ' })).rejects.toThrow('[')
    expect(getTaskMock).not.toHaveBeenCalled()
  })

  it('validates cancel-task IPC input before delegating', async () => {
    const service = new FileProcessingOrchestrationService()
    const ipcHandleSpy = vi.spyOn(service as any, 'ipcHandle').mockReturnValue({ dispose: vi.fn() })
    ;(service as any).onInit()

    const cancelTaskHandler = ipcHandleSpy.mock.calls.find((call) => call[0] === 'file-processing:cancel-task')?.[1] as
      | RegisteredIpcHandler
      | undefined

    expect(cancelTaskHandler).toBeDefined()

    await expect(cancelTaskHandler!({}, { taskId: '   ' })).rejects.toThrow('[')
    expect(cancelTaskMock).not.toHaveBeenCalled()
  })

  it('delegates start/get/cancel requests to FileProcessingTaskService', async () => {
    const service = new FileProcessingOrchestrationService()

    startTaskMock.mockResolvedValueOnce({
      taskId: 'task-1',
      feature: 'image_to_text',
      status: 'processing',
      progress: 0,
      processorId: 'tesseract'
    })
    getTaskMock.mockResolvedValueOnce({
      taskId: 'task-1',
      feature: 'image_to_text',
      status: 'processing',
      progress: 50,
      processorId: 'tesseract'
    })
    cancelTaskMock.mockResolvedValueOnce({
      taskId: 'task-1',
      feature: 'image_to_text',
      status: 'cancelled',
      progress: 50,
      processorId: 'tesseract',
      reason: 'cancelled'
    })

    await expect(
      service.startTask({
        feature: 'image_to_text',
        file: imageFile as never
      })
    ).resolves.toEqual({
      taskId: 'task-1',
      feature: 'image_to_text',
      status: 'processing',
      progress: 0,
      processorId: 'tesseract'
    })

    await expect(service.getTask({ taskId: 'task-1' })).resolves.toEqual({
      taskId: 'task-1',
      feature: 'image_to_text',
      status: 'processing',
      progress: 50,
      processorId: 'tesseract'
    })

    await expect(service.cancelTask({ taskId: 'task-1' })).resolves.toEqual({
      taskId: 'task-1',
      feature: 'image_to_text',
      status: 'cancelled',
      progress: 50,
      processorId: 'tesseract',
      reason: 'cancelled'
    })

    expect(startTaskMock).toHaveBeenCalledWith(
      {
        feature: 'image_to_text',
        file: imageFile
      },
      undefined
    )
    expect(getTaskMock).toHaveBeenCalledWith({ taskId: 'task-1' }, undefined)
    expect(cancelTaskMock).toHaveBeenCalledWith({ taskId: 'task-1' })
  })

  it('validates list-available-processors output', () => {
    const service = new FileProcessingOrchestrationService()

    listAvailableProcessorIdsMock.mockReturnValueOnce(['system', 'ovocr'])

    expect(service.listAvailableProcessors()).toEqual({
      processorIds: ['system', 'ovocr']
    })

    listAvailableProcessorIdsMock.mockReturnValueOnce(['missing'])

    expect(() => service.listAvailableProcessors()).toThrow('[')
  })
})
