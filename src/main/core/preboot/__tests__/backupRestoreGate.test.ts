import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type { readRestoreJournal } from '@data/db/restore/restoreJournal'

const runRestorePromotionMock = vi.fn<() => Promise<void>>()
const markRestoreFailedAfterCrashMock = vi.fn<() => void>()
const isLiveDbStrandedMock = vi.fn<() => boolean>()
const cleanupTerminalRestoreArtifactsMock = vi.fn<() => void>()
const readRestoreJournalMock = vi.fn<typeof readRestoreJournal>()
const showErrorBoxMock = vi.fn()
const electronState = { ready: false, sessionData: '' }
const setPathMock = vi.fn((key: string, value: string) => {
  if (key === 'sessionData') electronState.sessionData = value
})

vi.mock('@data/db/restore/restoreJournal', () => ({ readRestoreJournal: () => readRestoreJournalMock() }))
vi.mock('electron', () => ({
  app: {
    whenReady: vi.fn().mockResolvedValue(undefined),
    getLocale: () => 'en-US',
    isReady: () => electronState.ready,
    setPath: (...args: [string, string]) => setPathMock(...args)
  },
  dialog: { showErrorBox: (...args: unknown[]) => showErrorBoxMock(...args) }
}))

vi.mock('@data/db/restore/restorePromotion', () => ({
  runRestorePromotion: () => runRestorePromotionMock(),
  markRestoreFailedAfterCrash: () => markRestoreFailedAfterCrashMock(),
  isLiveDbStranded: () => isLiveDbStrandedMock(),
  cleanupTerminalRestoreArtifacts: () => cleanupTerminalRestoreArtifactsMock()
}))

import { prepareBackupRestoreSession, runBackupRestoreGate } from '../backupRestoreGate'

let profileRoot: string
let sessionRoot: string

function setJournalState(state: 'staged' | 'promoting' | 'completed' | 'failed' | 'expired'): void {
  readRestoreJournalMock.mockReturnValue({
    kind: 'ok',
    journal: { state } as Extract<ReturnType<typeof readRestoreJournal>, { kind: 'ok' }>['journal']
  })
}

beforeEach(() => {
  runRestorePromotionMock.mockReset()
  markRestoreFailedAfterCrashMock.mockReset()
  isLiveDbStrandedMock.mockReset()
  cleanupTerminalRestoreArtifactsMock.mockReset()
  isLiveDbStrandedMock.mockReturnValue(false)
  readRestoreJournalMock.mockReturnValue({ kind: 'none' })
  showErrorBoxMock.mockClear()
  setPathMock.mockClear()
  electronState.ready = false
  profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-restore-session-'))
  sessionRoot = path.join(profileRoot, 'restore-session')
  electronState.sessionData = profileRoot
  vi.spyOn(application, 'getPath').mockImplementation((key, filename) => {
    if (key !== 'feature.backup.restore.session') throw new Error(`Unexpected path: ${key}`)
    return filename ? path.join(sessionRoot, filename) : sessionRoot
  })
  vi.mocked(application.relaunch).mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(profileRoot, { recursive: true, force: true })
})

describe('prepareBackupRestoreSession', () => {
  it.each(['staged', 'promoting'] as const)('keeps session writes out of a %s restore target', async (state) => {
    setJournalState(state)
    const liveStorage = path.join(profileRoot, 'Local Storage')
    fs.mkdirSync(liveStorage)
    fs.writeFileSync(path.join(liveStorage, 'data'), 'previous data')

    expect(prepareBackupRestoreSession()).toBe(true)
    await Promise.resolve()
    fs.mkdirSync(path.join(electronState.sessionData, 'Local Storage'))
    fs.writeFileSync(path.join(electronState.sessionData, 'Local Storage', 'data'), 'session write')

    expect(fs.readFileSync(path.join(liveStorage, 'data'), 'utf8')).toBe('previous data')
    expect(path.dirname(electronState.sessionData)).toBe(sessionRoot)
  })

  it('removes the previous isolated session on the next normal launch without touching live storage', () => {
    fs.mkdirSync(sessionRoot)
    fs.writeFileSync(path.join(sessionRoot, 'temporary'), 'temporary')
    fs.writeFileSync(path.join(profileRoot, 'live'), 'restored data')

    expect(prepareBackupRestoreSession()).toBe(false)
    expect(electronState.sessionData).toBe(profileRoot)
    expect(fs.existsSync(sessionRoot)).toBe(false)
    expect(fs.readFileSync(path.join(profileRoot, 'live'), 'utf8')).toBe('restored data')
  })

  it('does not isolate a terminal journal or create a session on a normal launch', () => {
    setJournalState('completed')
    expect(prepareBackupRestoreSession()).toBe(false)
    expect(electronState.sessionData).toBe(profileRoot)
    expect(fs.existsSync(sessionRoot)).toBe(false)
  })

  it('refuses a restore if isolation is attempted after Electron has initialized', () => {
    setJournalState('staged')
    electronState.ready = true
    fs.mkdirSync(sessionRoot)
    fs.writeFileSync(path.join(sessionRoot, 'active'), 'active session')
    expect(() => prepareBackupRestoreSession()).toThrow(/before Electron is ready/)
    expect(electronState.sessionData).toBe(profileRoot)
    expect(fs.readFileSync(path.join(sessionRoot, 'active'), 'utf8')).toBe('active session')
  })

  it('refuses promotion when setting the isolated session path fails', () => {
    setJournalState('staged')
    setPathMock.mockImplementationOnce(() => {
      throw new Error('session initialization failed')
    })
    expect(() => prepareBackupRestoreSession()).toThrow('session initialization failed')
    expect(electronState.sessionData).toBe(profileRoot)
  })
})

describe('runBackupRestoreGate', () => {
  it.each(['failed', 'expired'] as const)('reports a %s restore before its journal is consumed', async (state) => {
    readRestoreJournalMock.mockReturnValue({
      kind: 'ok',
      journal: { state } as Extract<ReturnType<typeof readRestoreJournal>, { kind: 'ok' }>['journal']
    })
    cleanupTerminalRestoreArtifactsMock.mockImplementation(() => {
      expect(showErrorBoxMock).toHaveBeenCalledWith(
        'Restore failed',
        expect.stringContaining('Your previous data has been kept')
      )
    })

    await expect(runBackupRestoreGate()).resolves.toBe('skipped')
    expect(showErrorBoxMock).toHaveBeenCalledOnce()
  })

  it('delegates to the promotion logic and skips the crash net on success', async () => {
    runRestorePromotionMock.mockResolvedValue(undefined)

    await expect(runBackupRestoreGate()).resolves.toBe('skipped')

    expect(showErrorBoxMock).not.toHaveBeenCalled()
  })

  it.each(['completed', 'failed', 'expired'] as const)(
    'leaves an isolated %s launch before normal bootstrap',
    async (state) => {
      setJournalState('staged')
      const isolated = prepareBackupRestoreSession()
      runRestorePromotionMock.mockImplementation(async () => setJournalState(state))
      cleanupTerminalRestoreArtifactsMock.mockImplementation(() =>
        readRestoreJournalMock.mockReturnValue({ kind: 'none' })
      )
      let normalBootstrapReached = false

      if ((await runBackupRestoreGate(isolated)) !== 'handled') normalBootstrapReached = true

      expect(normalBootstrapReached).toBe(false)
      expect(readRestoreJournalMock()).toEqual({ kind: 'none' })
      expect(application.relaunch).toHaveBeenCalledOnce()
      expect(showErrorBoxMock).toHaveBeenCalledTimes(state === 'completed' ? 0 : 1)
    }
  )

  it('relaunches after an unexpected promotion error has been recovered', async () => {
    runRestorePromotionMock.mockRejectedValue(new Error('promotion crash'))
    markRestoreFailedAfterCrashMock.mockImplementation(() => setJournalState('failed'))
    cleanupTerminalRestoreArtifactsMock.mockImplementation(() =>
      readRestoreJournalMock.mockReturnValue({ kind: 'none' })
    )

    await expect(runBackupRestoreGate(true)).resolves.toBe('handled')
    expect(showErrorBoxMock).toHaveBeenCalledWith('Restore failed', expect.stringContaining('previous data'))
  })

  it.each(['promoting', 'completed', 'failed'] as const)(
    'does not create a relaunch loop when a %s journal survives cleanup',
    async (state) => {
      setJournalState(state)

      await expect(runBackupRestoreGate(true)).rejects.toThrow(/unresolved/)
      expect(application.relaunch).not.toHaveBeenCalled()
      expect(readRestoreJournalMock()).toMatchObject({ journal: { state } })
    }
  )

  it('preserves crash artifacts when recovery fails in an isolated launch', async () => {
    setJournalState('promoting')
    runRestorePromotionMock.mockRejectedValue(new Error('promotion crash'))
    markRestoreFailedAfterCrashMock.mockImplementation(() => {
      throw new Error('recovery failed')
    })

    await expect(runBackupRestoreGate(true)).rejects.toThrow(/unresolved/)
    expect(readRestoreJournalMock()).toMatchObject({ journal: { state: 'promoting' } })
    expect(application.relaunch).not.toHaveBeenCalled()
  })

  it('refuses to boot when recovery left the live DB stranded in the aside', async () => {
    runRestorePromotionMock.mockRejectedValue(new Error('boom'))
    isLiveDbStrandedMock.mockReturnValue(true)

    // Booting on would create a fresh empty database while the user's data
    // sits in the aside — the one case worse than the fail-fast dialog.
    await expect(runBackupRestoreGate()).rejects.toThrow(/empty database/)
    expect(cleanupTerminalRestoreArtifactsMock).not.toHaveBeenCalled()
  })

  it('refuses to boot when the crash net itself failed and the live DB is stranded', async () => {
    runRestorePromotionMock.mockRejectedValue(new Error('boom'))
    markRestoreFailedAfterCrashMock.mockImplementation(() => {
      throw new Error('EBUSY: aside rename blocked')
    })
    isLiveDbStrandedMock.mockReturnValue(true)

    await expect(runBackupRestoreGate()).rejects.toThrow(/empty database/)
    expect(cleanupTerminalRestoreArtifactsMock).not.toHaveBeenCalled()
  })
})
