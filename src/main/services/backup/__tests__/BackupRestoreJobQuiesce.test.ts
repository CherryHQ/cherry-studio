import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationGet } = vi.hoisted(() => ({ applicationGet: vi.fn() }))
vi.mock('@application', () => ({ application: { get: applicationGet } }))

import { BackupRestoreJobQuiesce } from '../BackupRestoreJobQuiesce'
import { BackupCancelledError } from '../errors'

describe('BackupRestoreJobQuiesce', () => {
  let dispose: ReturnType<typeof vi.fn>
  let jobManager: {
    pause: ReturnType<typeof vi.fn>
    drainInFlight: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    dispose = vi.fn()
    jobManager = {
      pause: vi.fn(() => ({ dispose })),
      drainInFlight: vi.fn().mockResolvedValue({ stragglerIds: [], startupRecoveryPending: false })
    }
    applicationGet.mockReset()
    applicationGet.mockReturnValue(jobManager)
    mockMainLoggerService.warn.mockClear()
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid drain timeout %s', (timeoutMs) => {
    expect(() => new BackupRestoreJobQuiesce(timeoutMs)).toThrow('positive integer')
  })

  it('does not acquire a hold when the restore signal was already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(new BackupRestoreJobQuiesce(15_000).quiesce(controller.signal)).rejects.toBeInstanceOf(
      BackupCancelledError
    )

    expect(jobManager.pause).not.toHaveBeenCalled()
    expect(jobManager.drainInFlight).not.toHaveBeenCalled()
  })

  it('keeps the hold after a clean drain until the restore outcome is known', async () => {
    const quiesce = new BackupRestoreJobQuiesce(15_000)

    await quiesce.quiesce()

    expect(jobManager.pause).toHaveBeenCalledWith('backup restore')
    expect(jobManager.drainInFlight).toHaveBeenCalledWith({ timeoutMs: 15_000 })
    expect(dispose).not.toHaveBeenCalled()
  })

  it('releases the hold and rejects when JobManager reports stragglers', async () => {
    jobManager.drainInFlight.mockResolvedValue({ stragglerIds: ['job-1'], startupRecoveryPending: false })

    await expect(new BackupRestoreJobQuiesce(15_000).quiesce()).rejects.toThrow('did not drain cleanly')

    expect(dispose).toHaveBeenCalledOnce()
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'restore JobManager drain was not clean',
      expect.objectContaining({ stragglerIds: ['job-1'], startupRecoveryPending: false })
    )
  })

  it('releases the hold and rejects while startup recovery remains pending', async () => {
    jobManager.drainInFlight.mockResolvedValue({ stragglerIds: [], startupRecoveryPending: true })

    await expect(new BackupRestoreJobQuiesce(15_000).quiesce()).rejects.toThrow('did not drain cleanly')

    expect(dispose).toHaveBeenCalledOnce()
  })

  it('releases the hold when draining rejects', async () => {
    const failure = new Error('drain transport failed')
    jobManager.drainInFlight.mockRejectedValue(failure)

    await expect(new BackupRestoreJobQuiesce(15_000).quiesce()).rejects.toBe(failure)

    expect(dispose).toHaveBeenCalledOnce()
  })

  it('releases the hold when cancellation occurs after a clean drain', async () => {
    const controller = new AbortController()
    jobManager.drainInFlight.mockImplementation(async () => {
      controller.abort()
      return { stragglerIds: [], startupRecoveryPending: false }
    })

    await expect(new BackupRestoreJobQuiesce(15_000).quiesce(controller.signal)).rejects.toBeInstanceOf(
      BackupCancelledError
    )

    expect(dispose).toHaveBeenCalledOnce()
  })

  it('releases an uncommitted hold exactly once', async () => {
    const quiesce = new BackupRestoreJobQuiesce(15_000)
    await quiesce.quiesce()

    quiesce.disposeOnAbort()
    quiesce.disposeOnAbort()

    expect(dispose).toHaveBeenCalledOnce()
  })

  it('retains a clean hold after the staged journal commits', async () => {
    const quiesce = new BackupRestoreJobQuiesce(15_000)
    await quiesce.quiesce()

    quiesce.retainForRelaunch()
    quiesce.disposeOnAbort()

    expect(dispose).not.toHaveBeenCalled()
  })

  it('requires a clean acquired hold before it can be retained', () => {
    expect(() => new BackupRestoreJobQuiesce(15_000).retainForRelaunch()).toThrow('was not acquired')
  })
})
