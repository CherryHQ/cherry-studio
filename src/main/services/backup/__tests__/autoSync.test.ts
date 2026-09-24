import { beforeEach, describe, expect, it, vi } from 'vitest'

const { exportToDestinationMock, jobManager, listRunsMock, preferences } = vi.hoisted(() => ({
  exportToDestinationMock: vi.fn(),
  listRunsMock: vi.fn(),
  jobManager: {
    getJobSchedule: vi.fn(),
    registerJobSchedule: vi.fn(() => ({ id: 'schedule-1' })),
    updateJobSchedule: vi.fn()
  },
  preferences: { get: vi.fn() }
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'JobManager') return jobManager
      if (name === 'PreferenceService') return preferences
      if (name === 'BackupService') return { exportToDestination: exportToDestinationMock }
      throw new Error(`Unexpected service: ${name}`)
    }
  }
}))
vi.mock('@data/services/JobService', () => ({ jobService: { listRecentTerminalByScheduleId: listRunsMock } }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))

const { autoSyncJobHandler, readAutoSyncStatus, reconcileAutoSyncSchedules } = await import('../autoSync')
const { BackupBusyError, DestinationNotConfiguredError } = await import('../errors')

/** Every destination off unless the test says otherwise. */
function settings(overrides: Record<string, unknown> = {}) {
  preferences.get.mockImplementation((key: string) => {
    if (key in overrides) return overrides[key]
    return key.endsWith('.auto_sync') ? false : 0
  })
}

const WEBDAV_ON = {
  'data.backup.webdav.auto_sync': true,
  'data.backup.webdav.sync_interval': 60
}

/** Only WebDAV has a row; the other three destinations were never scheduled. */
function onlyWebdavScheduled(schedule: Record<string, unknown>) {
  jobManager.getJobSchedule.mockImplementation((_type: string, name: string) => (name === 'webdav' ? schedule : null))
}

beforeEach(() => {
  vi.clearAllMocks()
  jobManager.getJobSchedule.mockReturnValue(null)
  jobManager.registerJobSchedule.mockReturnValue({ id: 'schedule-1' })
})

describe('reconcileAutoSyncSchedules', () => {
  it('schedules a destination the user turned on', () => {
    settings(WEBDAV_ON)

    reconcileAutoSyncSchedules()

    expect(jobManager.registerJobSchedule).toHaveBeenCalledExactlyOnceWith({
      type: 'backup.auto-sync',
      name: 'webdav',
      trigger: { kind: 'interval', ms: 3_600_000, anchor: 'lastRun' },
      jobInputTemplate: { destination: 'webdav' },
      catchUpPolicy: { kind: 'after-startup', minutes: 5 }
    })
  })

  // The settings UI spells "off" as a zero interval; a zero-delay timer would
  // back up in a hot loop.
  it('treats a zero interval as off even when the switch is on', () => {
    settings({ 'data.backup.webdav.auto_sync': true, 'data.backup.webdav.sync_interval': 0 })

    reconcileAutoSyncSchedules()

    expect(jobManager.registerJobSchedule).not.toHaveBeenCalled()
  })

  // `updateJobSchedule` re-arms on field PRESENCE, so an unchanged trigger in
  // the patch restarts the interval — and any unrelated settings edit would
  // push the next backup out again, forever.
  it('leaves an already-correct schedule alone', () => {
    settings(WEBDAV_ON)
    onlyWebdavScheduled({
      id: 'schedule-1',
      enabled: true,
      trigger: { kind: 'interval', ms: 3_600_000, anchor: 'lastRun' }
    })

    reconcileAutoSyncSchedules()

    expect(jobManager.updateJobSchedule).not.toHaveBeenCalled()
    expect(jobManager.registerJobSchedule).not.toHaveBeenCalled()
  })

  it('re-arms only when the interval actually changed', () => {
    settings({ ...WEBDAV_ON, 'data.backup.webdav.sync_interval': 30 })
    onlyWebdavScheduled({
      id: 'schedule-1',
      enabled: true,
      trigger: { kind: 'interval', ms: 3_600_000, anchor: 'lastRun' }
    })

    reconcileAutoSyncSchedules()

    expect(jobManager.updateJobSchedule).toHaveBeenCalledExactlyOnceWith('schedule-1', {
      trigger: { kind: 'interval', ms: 1_800_000, anchor: 'lastRun' }
    })
  })

  // A restore leaves the row disabled; turning the destination back on must
  // enable that row rather than register a second one.
  it('re-enables a schedule a restore switched off', () => {
    settings(WEBDAV_ON)
    onlyWebdavScheduled({
      id: 'schedule-1',
      enabled: false,
      trigger: { kind: 'interval', ms: 3_600_000, anchor: 'lastRun' }
    })

    reconcileAutoSyncSchedules()

    expect(jobManager.updateJobSchedule).toHaveBeenCalledExactlyOnceWith('schedule-1', { enabled: true })
  })

  it('disables the schedule when the user turns the destination off', () => {
    settings()
    onlyWebdavScheduled({
      id: 'schedule-1',
      enabled: true,
      trigger: { kind: 'interval', ms: 3_600_000, anchor: 'lastRun' }
    })

    reconcileAutoSyncSchedules()

    expect(jobManager.updateJobSchedule).toHaveBeenCalledExactlyOnceWith('schedule-1', { enabled: false })
  })

  it('says nothing about a destination that was never scheduled', () => {
    settings()

    reconcileAutoSyncSchedules()

    expect(jobManager.updateJobSchedule).not.toHaveBeenCalled()
    expect(jobManager.registerJobSchedule).not.toHaveBeenCalled()
  })
})

describe('autoSyncJobHandler', () => {
  const run = (signal = new AbortController().signal) =>
    autoSyncJobHandler.execute({ input: { destination: 's3' }, signal } as never)

  // The job's signal is how JobManager cancels a run; dropping it would let a
  // cancelled job keep exporting after its row went terminal.
  it("exports to the payload's destination under the job's signal", async () => {
    exportToDestinationMock.mockResolvedValue({ name: 'cherry-studio.zip' })
    const { signal } = new AbortController()

    await expect(run(signal)).resolves.toEqual({ name: 'cherry-studio.zip' })
    expect(exportToDestinationMock).toHaveBeenCalledExactlyOnceWith('s3', undefined, signal)
  })

  // Retrying cannot configure the destination; the status page reports it.
  it('skips an unconfigured destination instead of failing', async () => {
    exportToDestinationMock.mockRejectedValue(new DestinationNotConfiguredError('s3', 'bucket'))

    await expect(run()).resolves.toEqual({ skipped: 'not-configured' })
  })

  // A manual export can outlast every retry; that is not a failed backup.
  it('skips a turn that meets a manual backup operation', async () => {
    exportToDestinationMock.mockRejectedValue(new BackupBusyError('export', 'export'))

    await expect(run()).resolves.toEqual({ skipped: 'busy' })
  })

  it('lets a real transport failure reach the job runner', async () => {
    exportToDestinationMock.mockRejectedValue(new Error('network down'))

    await expect(run()).rejects.toThrow('network down')
  })
})

describe('readAutoSyncStatus', () => {
  type Run = { status: string; finishedAt: string; output?: unknown }
  /** Newest first, as JobService returns them. */
  function webdavRuns(...runs: Run[]) {
    onlyWebdavScheduled({ id: 'schedule-1', enabled: true })
    listRunsMock.mockReturnValue(runs.map((run) => ({ output: null, ...run })))
  }
  const webdav = () => readAutoSyncStatus().find((entry) => entry.destination === 'webdav')

  const OK = { status: 'completed', finishedAt: '2026-09-20T08:00:00.000Z', output: { name: 'a.zip' } }

  it('reports when the last archive was written', () => {
    webdavRuns(OK)

    expect(webdav()).toEqual({ destination: 'webdav', lastSuccessAt: Date.parse(OK.finishedAt) })
  })

  // A skipped run completes normally; it must not pass for a backup.
  it('reports an unconfigured destination without counting it as a backup', () => {
    webdavRuns(
      { status: 'completed', finishedAt: '2026-09-21T08:00:00.000Z', output: { skipped: 'not-configured' } },
      OK
    )

    expect(webdav()).toEqual({
      destination: 'webdav',
      lastSuccessAt: Date.parse(OK.finishedAt),
      problem: 'not-configured'
    })
  })

  it('reports a failed latest run beside the last good one', () => {
    webdavRuns({ status: 'failed', finishedAt: '2026-09-21T08:00:00.000Z' }, OK)

    expect(webdav()).toMatchObject({ lastSuccessAt: Date.parse(OK.finishedAt), problem: 'failed' })
  })

  // Neither a turn deferred by a manual backup nor a cancelled run says anything
  // about the destination, so neither may hide the failure before it.
  it('looks past busy skips and cancellations to the run that decided', () => {
    webdavRuns(
      { status: 'completed', finishedAt: '2026-09-22T09:00:00.000Z', output: { skipped: 'busy' } },
      { status: 'cancelled', finishedAt: '2026-09-22T08:00:00.000Z' },
      { status: 'failed', finishedAt: '2026-09-21T08:00:00.000Z' },
      OK
    )

    expect(webdav()).toMatchObject({ lastSuccessAt: Date.parse(OK.finishedAt), problem: 'failed' })
  })

  it('has no backup on record for a destination whose runs never wrote one', () => {
    webdavRuns({ status: 'failed', finishedAt: '2026-09-21T08:00:00.000Z' })

    expect(webdav()).toEqual({ destination: 'webdav', lastSuccessAt: null, problem: 'failed' })
  })
})
