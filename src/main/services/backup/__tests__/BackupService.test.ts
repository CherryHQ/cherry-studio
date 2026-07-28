import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { acknowledgeMock, exportMock, prepareMock, journalMock, loggerMock } = vi.hoisted(() => ({
  acknowledgeMock: vi.fn(() => ({ acknowledged: true, restoreId: '11111111-2222-4333-8444-555555555555', removed: 1 })),
  exportMock: vi.fn(),
  prepareMock: vi.fn(),
  journalMock: vi.fn(),
  loggerMock: { info: vi.fn(), error: vi.fn() }
}))

vi.mock('@logger', () => ({ loggerService: { withContext: () => loggerMock } }))
vi.mock('@data/db/restore/restoreJournal', () => ({ readRestoreJournal: journalMock }))
vi.mock('../acknowledgeRestore', () => ({ acknowledgeRestore: acknowledgeMock }))
vi.mock('../exportArchive', () => ({ exportArchive: exportMock }))
vi.mock('../prepareRestore', () => ({
  prepareRestore: prepareMock,
  cancelPreparedRestore: vi.fn(),
  armPreparedRestore: vi.fn()
}))
vi.mock('../rollbackRestore', () => ({ armRestoreRollback: vi.fn() }))

import { BaseService } from '@main/core/lifecycle/BaseService'

import { BackupService } from '../BackupService'
import { BackupBusyError } from '../errors'

function init(service: BackupService): void {
  ;(service as unknown as { onInit(): void }).onInit()
}
function stop(service: BackupService): Promise<void> {
  return (service as unknown as { onStop(): Promise<void> }).onStop()
}

describe('BackupService', () => {
  let service: BackupService
  beforeEach(() => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    journalMock.mockReturnValue({ kind: 'none' })
    service = new BackupService()
    init(service)
  })
  afterEach(() => BaseService.resetInstances())

  it('reports a generic DB-only journal without a Full preset', () => {
    journalMock.mockReturnValue({
      kind: 'ok',
      journal: { state: 'prepared', restoreId: '11111111-2222-4333-8444-555555555555' }
    })
    expect(service.getStatus()).toEqual({
      operation: null,
      restore: { kind: 'journal', state: 'prepared', restoreId: '11111111-2222-4333-8444-555555555555' }
    })
  })

  it('serializes export and restore preparation', async () => {
    let rejection: unknown
    await service.runExclusive('export', async () => {
      rejection = await service.runExclusive('prepare-restore', async () => undefined).catch((error) => error)
    })
    expect(rejection).toBeInstanceOf(BackupBusyError)
  })

  it('owns the cancellation signal and waits for it at shutdown', async () => {
    let signal: AbortSignal | undefined
    const operation = service.runExclusive('export', async (value) => {
      signal = value
      await new Promise<void>((resolve) => value.addEventListener('abort', () => resolve(), { once: true }))
    })
    await vi.waitFor(() => expect(signal).toBeDefined())
    await stop(service)
    expect(signal?.aborted).toBe(true)
    await operation
  })

  it('delegates Lite export without a preset argument', async () => {
    exportMock.mockResolvedValue({ outPath: '/tmp/a.cherrybackup' })
    await service.export('/tmp/a.cherrybackup')
    expect(exportMock).toHaveBeenCalledWith(expect.objectContaining({ outPath: '/tmp/a.cherrybackup' }))
  })
})
