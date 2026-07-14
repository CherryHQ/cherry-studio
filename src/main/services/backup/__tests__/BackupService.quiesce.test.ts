import { application } from '@application'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BackupRestoreJobQuiesce, BackupService } from '../BackupService'
import { BackupCancelledError, RestoreQuiesceNotImplementedError } from '../errors'

const { captureFingerprint, createSnapshot } = vi.hoisted(() => ({
  captureFingerprint: vi.fn(),
  createSnapshot: vi.fn()
}))

vi.mock('../ImportOrchestrator', () => ({
  ImportOrchestrator: class {
    constructor(private readonly deps: { quiesceWriters: (signal?: AbortSignal) => Promise<void> }) {}

    async importBackup(options: { signal?: AbortSignal }): Promise<never> {
      await this.deps.quiesceWriters(options.signal)
      captureFingerprint()
      createSnapshot()
      throw new Error('unexpected restore continuation')
    }
  }
}))

vi.mock('@main/data/db/restore/restoreJournal', () => ({
  readRestoreJournal: vi.fn(() => ({ kind: 'none' }))
}))

interface JobManagerMock {
  readonly pause: ReturnType<typeof vi.fn>
  readonly drainInFlight: ReturnType<typeof vi.fn>
}

describe('BackupRestoreJobQuiesce', () => {
  let disposeHold: ReturnType<typeof vi.fn>
  let jobManager: JobManagerMock

  beforeEach(() => {
    vi.clearAllMocks()
    mockMainLoggerService.warn.mockClear()
    disposeHold = vi.fn()
    jobManager = {
      pause: vi.fn(() => ({ dispose: disposeHold })),
      drainInFlight: vi.fn()
    }
    vi.spyOn(application, 'get').mockImplementation((name: string) => {
      if (name === 'JobManager') return jobManager as never
      throw new Error(`Unexpected application.get(${name})`)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects invalid drain timeouts before acquiring a hold', () => {
    expect(() => new BackupRestoreJobQuiesce(0)).toThrow(/positive integer/)
    expect(() => new BackupRestoreJobQuiesce(1.5)).toThrow(/positive integer/)
    expect(() => new BackupRestoreJobQuiesce(Number.POSITIVE_INFINITY)).toThrow(/positive integer/)

    expect(jobManager.pause).not.toHaveBeenCalled()
  })

  it('rejects a pre-aborted signal before acquiring a hold', async () => {
    const abortController = new AbortController()
    abortController.abort()
    const quiesce = new BackupRestoreJobQuiesce(5000)

    await expect(quiesce.quiesce(abortController.signal)).rejects.toThrow(BackupCancelledError)

    expect(jobManager.pause).not.toHaveBeenCalled()
    expect(jobManager.drainInFlight).not.toHaveBeenCalled()
  })

  it('accepts a clean verdict and releases the hold exactly once on abort cleanup', async () => {
    jobManager.drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: false })
    const quiesce = new BackupRestoreJobQuiesce(12_345)

    await quiesce.quiesce()
    quiesce.disposeOnAbort()
    quiesce.disposeOnAbort()

    expect(jobManager.pause).toHaveBeenCalledWith('backup restore')
    expect(jobManager.drainInFlight).toHaveBeenCalledWith({ timeoutMs: 12_345 })
    expect(disposeHold).toHaveBeenCalledOnce()
  })

  it('rejects re-acquisition while the hold is owned', async () => {
    jobManager.drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: false })
    const quiesce = new BackupRestoreJobQuiesce(5000)

    await quiesce.quiesce()
    await expect(quiesce.quiesce()).rejects.toThrow(/already acquired/)
    quiesce.disposeOnAbort()

    expect(jobManager.pause).toHaveBeenCalledOnce()
    expect(jobManager.drainInFlight).toHaveBeenCalledOnce()
    expect(disposeHold).toHaveBeenCalledOnce()
  })

  it('releases the hold when the bounded drain fails', async () => {
    jobManager.drainInFlight.mockRejectedValue(new Error('drain failed'))
    const quiesce = new BackupRestoreJobQuiesce(5000)

    await expect(quiesce.quiesce()).rejects.toThrow('drain failed')
    quiesce.disposeOnAbort()

    expect(disposeHold).toHaveBeenCalledOnce()
  })

  it('does not retain a hold while the bounded drain is still pending', async () => {
    let rejectDrain: ((reason: Error) => void) | undefined
    const pendingDrain = new Promise<never>((_resolve, reject) => {
      rejectDrain = reject
    })
    jobManager.drainInFlight.mockReturnValue(pendingDrain)
    const quiesce = new BackupRestoreJobQuiesce(5000)

    const pendingQuiesce = quiesce.quiesce()
    expect(() => quiesce.retainForRelaunch()).toThrow(/did not drain cleanly/)
    rejectDrain?.(new Error('drain failed'))
    await expect(pendingQuiesce).rejects.toThrow('drain failed')
    quiesce.disposeOnAbort()

    expect(disposeHold).toHaveBeenCalledOnce()
  })

  it('fails closed on stragglers, logs diagnostics, and releases the hold exactly once', async () => {
    jobManager.drainInFlight.mockResolvedValue({
      stragglerIds: ['job-1', 'job-2'],
      startupRecoveryPending: false
    })
    const quiesce = new BackupRestoreJobQuiesce(5000)

    await expect(quiesce.quiesce()).rejects.toThrow(/did not drain cleanly/)
    quiesce.disposeOnAbort()

    expect(mockMainLoggerService.warn).toHaveBeenCalledWith('restore JobManager drain was not clean', {
      stragglerIds: ['job-1', 'job-2'],
      startupRecoveryPending: false,
      timeoutMs: 5000
    })
    expect(disposeHold).toHaveBeenCalledOnce()
  })

  it('fails closed when startup recovery remains pending and releases the hold', async () => {
    jobManager.drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: true })
    const quiesce = new BackupRestoreJobQuiesce(5000)

    await expect(quiesce.quiesce()).rejects.toThrow(/did not drain cleanly/)

    expect(mockMainLoggerService.warn).toHaveBeenCalledWith('restore JobManager drain was not clean', {
      stragglerIds: [],
      startupRecoveryPending: true,
      timeoutMs: 5000
    })
    expect(disposeHold).toHaveBeenCalledOnce()
  })

  it('retains the hold after commit instead of disposing before relaunch', async () => {
    jobManager.drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: false })
    const quiesce = new BackupRestoreJobQuiesce(5000)

    await quiesce.quiesce()
    quiesce.retainForRelaunch()
    quiesce.disposeOnAbort()

    expect(disposeHold).not.toHaveBeenCalled()
  })

  it('releases the hold when cancellation is observed after the bounded drain', async () => {
    const abortController = new AbortController()
    jobManager.drainInFlight.mockImplementation(async () => {
      abortController.abort()
      return { stragglerIds: [], startupRecoveryPending: false }
    })
    const quiesce = new BackupRestoreJobQuiesce(5000)

    await expect(quiesce.quiesce(abortController.signal)).rejects.toThrow(BackupCancelledError)

    expect(disposeHold).toHaveBeenCalledOnce()
  })
})

describe('BackupService production restore gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps production startRestore fail-closed before fingerprint or snapshot work', async () => {
    const service = new BackupService()

    await expect(service.startRestore({ archivePath: '/tmp/backup.cbu' })).rejects.toThrow(
      RestoreQuiesceNotImplementedError
    )

    expect(captureFingerprint).not.toHaveBeenCalled()
    expect(createSnapshot).not.toHaveBeenCalled()
  })
})
