import { beforeEach, describe, expect, it, vi } from 'vitest'

const { exportToDestinationMock, jobManager, preferences } = vi.hoisted(() => ({
  exportToDestinationMock: vi.fn(),
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
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))

const { autoSyncJobHandler, reconcileAutoSyncSchedules } = await import('../autoSync')
const { DestinationNotConfiguredError } = await import('../errors')

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

  // A restore forces every schedule row to `enabled: false`; nothing else turns
  // them back on.
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
  it('exports to the destination its payload names', async () => {
    exportToDestinationMock.mockResolvedValue({ name: 'cherry-studio.zip' })

    await expect(autoSyncJobHandler.execute({ input: { destination: 's3' } } as never)).resolves.toEqual({
      name: 'cherry-studio.zip'
    })
    expect(exportToDestinationMock).toHaveBeenCalledExactlyOnceWith('s3')
  })

  // Settings can be cleared while the schedule is still armed. Retrying that,
  // or surfacing it as a failed backup, would only be noise.
  it('skips an unconfigured destination instead of failing', async () => {
    exportToDestinationMock.mockRejectedValue(new DestinationNotConfiguredError('s3', 'bucket'))

    await expect(autoSyncJobHandler.execute({ input: { destination: 's3' } } as never)).resolves.toEqual({
      skipped: true
    })
  })

  it('lets a real transport failure reach the job runner', async () => {
    exportToDestinationMock.mockRejectedValue(new Error('network down'))

    await expect(autoSyncJobHandler.execute({ input: { destination: 's3' } } as never)).rejects.toThrow('network down')
  })
})
