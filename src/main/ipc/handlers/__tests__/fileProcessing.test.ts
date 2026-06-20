import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { fileProcessingHandlers } from '../fileProcessing'

const fileProcessingService = {
  startJob: vi.fn(),
  listAvailableProcessors: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'FileProcessingService') return fileProcessingService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

// File-processing handlers ignore IpcContext (they act on shared business data, not the
// caller's window), so the senderId value is irrelevant — pass a stable stub.
const ctx = { senderId: 'w1' }

type In<R extends keyof typeof fileProcessingHandlers> = Parameters<(typeof fileProcessingHandlers)[R]>[0]

describe('fileProcessingHandlers', () => {
  it('start_job forwards the input and returns the JobSnapshot', async () => {
    const input = {
      feature: 'image_to_text',
      file: { kind: 'entry', entryId: 'e1' },
      processorId: 'tesseract'
    } as In<'file_processing.start_job'>
    const snapshot = { id: 'job-1' }
    fileProcessingService.startJob.mockResolvedValue(snapshot)

    const result = await fileProcessingHandlers['file_processing.start_job'](input, ctx)

    expect(fileProcessingService.startJob).toHaveBeenCalledWith(input)
    expect(result).toBe(snapshot)
  })

  it('list_available_processors takes no input and returns the processor list', async () => {
    const list = { processorIds: ['tesseract'] }
    fileProcessingService.listAvailableProcessors.mockReturnValue(list)

    const result = await fileProcessingHandlers['file_processing.list_available_processors'](undefined, ctx)

    expect(fileProcessingService.listAvailableProcessors).toHaveBeenCalledWith()
    expect(result).toBe(list)
  })
})
