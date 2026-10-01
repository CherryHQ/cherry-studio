import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'

import type { KnowledgeIngestionService } from '../../ingestion/KnowledgeIngestionService'

const {
  cancelActiveKnowledgeJobsMock,
  deleteBaseRowMock,
  deleteStoreMock,
  notifyExternalSourcesDeletedMock,
  prepareExternalSourcesForBaseDeletionMock
} = vi.hoisted(() => ({
  cancelActiveKnowledgeJobsMock: vi.fn(),
  deleteBaseRowMock: vi.fn(),
  deleteStoreMock: vi.fn(),
  notifyExternalSourcesDeletedMock: vi.fn(),
  prepareExternalSourcesForBaseDeletionMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    KnowledgeVectorStoreService: {
      deleteStore: deleteStoreMock
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    delete: deleteBaseRowMock
  }
}))

vi.mock('../../tasks/utils/cancel', () => ({
  cancelActiveKnowledgeJobs: cancelActiveKnowledgeJobsMock
}))

const { KnowledgeBaseAdminService } = await import('../KnowledgeBaseAdminService')

function createService() {
  const lock = new KeyedMutex()
  const runExclusiveSpy = vi.spyOn(lock, 'runExclusive')

  return {
    runExclusiveSpy,
    service: new KnowledgeBaseAdminService(lock, {} as KnowledgeIngestionService, {
      prepareExternalSourcesForBaseDeletion: prepareExternalSourcesForBaseDeletionMock,
      notifyExternalSourcesDeleted: notifyExternalSourcesDeletedMock
    })
  }
}

describe('KnowledgeBaseAdminService deleteBase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cancelActiveKnowledgeJobsMock.mockResolvedValue(undefined)
    prepareExternalSourcesForBaseDeletionMock.mockResolvedValue(['source-1'])
    deleteStoreMock.mockResolvedValue(undefined)
    deleteBaseRowMock.mockReturnValue(undefined)
  })

  it('strictly settles jobs and schedules before deleting artifacts and atomically cascading the base row', async () => {
    const events: string[] = []
    cancelActiveKnowledgeJobsMock.mockImplementation(async () => events.push('cancel-jobs'))
    prepareExternalSourcesForBaseDeletionMock.mockImplementation(async () => {
      events.push('remove-schedules')
      return ['source-1']
    })
    deleteStoreMock.mockImplementation(async () => events.push('delete-base-artifacts'))
    deleteBaseRowMock.mockImplementation(() => events.push('delete-base'))
    notifyExternalSourcesDeletedMock.mockImplementation(() => events.push('notify-source-deletion'))
    const { runExclusiveSpy, service } = createService()

    await service.deleteBase('kb-1')

    expect(cancelActiveKnowledgeJobsMock).toHaveBeenCalledWith('kb-1', 'delete-base', {
      onCancelTimeout: 'throw'
    })
    expect(prepareExternalSourcesForBaseDeletionMock).toHaveBeenCalledWith('kb-1')
    expect(runExclusiveSpy).toHaveBeenCalledTimes(1)
    expect(runExclusiveSpy).toHaveBeenCalledWith('kb-1', expect.any(Function))
    expect(notifyExternalSourcesDeletedMock).toHaveBeenCalledWith('kb-1', ['source-1'])
    expect(events).toEqual([
      'cancel-jobs',
      'remove-schedules',
      'delete-base-artifacts',
      'delete-base',
      'notify-source-deletion'
    ])
  })

  it('does not unregister schedules or delete local data when a job cannot be settled', async () => {
    cancelActiveKnowledgeJobsMock.mockRejectedValueOnce(new Error('job still running'))
    const { runExclusiveSpy, service } = createService()

    await expect(service.deleteBase('kb-1')).rejects.toThrow('job still running')

    expect(prepareExternalSourcesForBaseDeletionMock).not.toHaveBeenCalled()
    expect(runExclusiveSpy).not.toHaveBeenCalled()
    expect(deleteStoreMock).not.toHaveBeenCalled()
    expect(deleteBaseRowMock).not.toHaveBeenCalled()
    expect(notifyExternalSourcesDeletedMock).not.toHaveBeenCalled()
  })

  it('does not delete local data when an external source schedule cannot be removed', async () => {
    prepareExternalSourcesForBaseDeletionMock.mockRejectedValueOnce(new Error('schedule unregister failed'))
    const { runExclusiveSpy, service } = createService()

    await expect(service.deleteBase('kb-1')).rejects.toThrow('schedule unregister failed')

    expect(runExclusiveSpy).not.toHaveBeenCalled()
    expect(deleteStoreMock).not.toHaveBeenCalled()
    expect(deleteBaseRowMock).not.toHaveBeenCalled()
    expect(notifyExternalSourcesDeletedMock).not.toHaveBeenCalled()
  })

  it('keeps the canonical base row when derived artifact cleanup fails', async () => {
    deleteStoreMock.mockRejectedValueOnce(new Error('artifact cleanup failed'))
    const { service } = createService()

    await expect(service.deleteBase('kb-1')).rejects.toThrow('artifact cleanup failed')

    expect(deleteBaseRowMock).not.toHaveBeenCalled()
    expect(notifyExternalSourcesDeletedMock).not.toHaveBeenCalled()
  })
})
