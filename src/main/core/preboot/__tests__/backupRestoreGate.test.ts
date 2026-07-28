import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Shell contract only (the promotion logic and the crash net's journal/aside
 * behavior are covered by restorePromotionV2.test.ts): the gate never throws —
 * a preboot exception lands in startApp's fail-fast catch — with exactly one
 * exception: when recovery left no live DB while the aside still holds the
 * user's data, booting on would CREATE a fresh empty database, so the gate
 * must refuse and fail fast instead.
 *
 * The v1 park gate is tested against a real filesystem (real journal bytes,
 * real renames) because preserving files is its entire job; only the v2
 * promotion below it is mocked.
 */

let userData = ''

vi.mock('@application', () => ({
  application: {
    getPath: vi.fn((key: string, filename?: string) => {
      const bases: Record<string, string> = {
        'app.userdata': userData,
        'app.database.file': join(userData, 'Data', 'cherrystudio.sqlite'),
        'feature.backup.restore.file': join(userData, 'Data', 'restore-journal.json')
      }
      const base = bases[key]
      if (!base) throw new Error(`Unexpected path key in backupRestoreGate test: ${key}`)
      return filename ? join(base, filename) : base
    })
  }
}))

const runRestorePromotionMock = vi.fn<() => Promise<void>>()
const markRestoreFailedAfterCrashMock = vi.fn<() => void>()
const isLiveDbStrandedMock = vi.fn<() => boolean>()
const isRestoreRollbackPendingMock = vi.fn<() => boolean>()

vi.mock('@data/db/restore/restorePromotionV2', () => ({
  runRestorePromotionV2: () => runRestorePromotionMock(),
  markRestoreFailedAfterCrashV2: () => markRestoreFailedAfterCrashMock(),
  isLiveDbStrandedV2: () => isLiveDbStrandedMock(),
  isRestoreRecoveryPendingV2: () => isRestoreRollbackPendingMock()
}))

import { runBackupRestoreGate } from '../backupRestoreGate'

const journalPath = () => join(userData, 'Data', 'restore-journal.json')
const parkedPath = () => `${journalPath()}.parked-v1`
const livePath = () => join(userData, 'Data', 'cherrystudio.sqlite')

/** A v1 journal as the v2 pre-releases wrote it — only `version` is ever read. */
const V1_JOURNAL_BYTES = JSON.stringify(
  {
    version: 1,
    restoreId: 'restore-abc',
    createdAt: '2026-07-01T00:00:00.000Z',
    state: 'staged',
    db: { promote: 'restore-staging/restore-abc/work.sqlite', aside: 'Data/aside.sqlite' },
    fileResources: []
  },
  null,
  2
)

function writeV1Journal(): void {
  writeFileSync(journalPath(), V1_JOURNAL_BYTES, 'utf8')
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'backup-restore-gate-'))
  mkdirSync(join(userData, 'Data'), { recursive: true })
  writeFileSync(livePath(), 'live-db', 'utf8')

  runRestorePromotionMock.mockReset()
  runRestorePromotionMock.mockResolvedValue(undefined)
  markRestoreFailedAfterCrashMock.mockReset()
  isLiveDbStrandedMock.mockReset()
  isLiveDbStrandedMock.mockReturnValue(false)
  isRestoreRollbackPendingMock.mockReset()
  isRestoreRollbackPendingMock.mockReturnValue(false)
})

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

describe('runBackupRestoreGate — v1 park gate', () => {
  it('does nothing when no journal exists at all', async () => {
    await expect(runBackupRestoreGate()).resolves.toBeUndefined()

    expect(existsSync(parkedPath())).toBe(false)
    expect(runRestorePromotionMock).toHaveBeenCalledOnce()
  })

  it('parks a v1 journal and boots on when the live database is in place', async () => {
    writeV1Journal()

    await expect(runBackupRestoreGate()).resolves.toBeUndefined()

    expect(existsSync(journalPath())).toBe(false)
    expect(existsSync(parkedPath())).toBe(true)
    // Dropping the restore intent must not touch the database it targeted.
    expect(readFileSync(livePath(), 'utf8')).toBe('live-db')
    expect(runRestorePromotionMock).not.toHaveBeenCalled()
  })

  it('parks by rename, so the parked file is the journal byte for byte', async () => {
    writeV1Journal()

    await runBackupRestoreGate()

    expect(readFileSync(parkedPath())).toEqual(Buffer.from(V1_JOURNAL_BYTES, 'utf8'))
  })

  it('refuses to boot and leaves the journal in place when the live database is missing', async () => {
    writeV1Journal()
    rmSync(livePath())

    await expect(runBackupRestoreGate()).rejects.toThrow(/refusing to boot into an empty database/)

    // The escape hatch is the journal under its original name: without it, the
    // build that staged this restore could no longer finish it.
    expect(readFileSync(journalPath(), 'utf8')).toBe(V1_JOURNAL_BYTES)
    expect(existsSync(parkedPath())).toBe(false)
    expect(runRestorePromotionMock).not.toHaveBeenCalled()
  })

  it('never overwrites an already parked journal', async () => {
    writeFileSync(parkedPath(), 'parked-earlier', 'utf8')
    writeV1Journal()

    await expect(runBackupRestoreGate()).resolves.toBeUndefined()

    expect(readFileSync(parkedPath(), 'utf8')).toBe('parked-earlier')
    expect(readFileSync(`${parkedPath()}.2`, 'utf8')).toBe(V1_JOURNAL_BYTES)
  })
})

describe('runBackupRestoreGate', () => {
  it('delegates to the promotion logic and skips the crash net on success', async () => {
    await expect(runBackupRestoreGate()).resolves.toBeUndefined()

    expect(runRestorePromotionMock).toHaveBeenCalledOnce()
    expect(markRestoreFailedAfterCrashMock).not.toHaveBeenCalled()
    expect(isLiveDbStrandedMock).not.toHaveBeenCalled()
    expect(isRestoreRollbackPendingMock).not.toHaveBeenCalled()
  })

  it('swallows a substance crash and invokes the crash net', async () => {
    runRestorePromotionMock.mockRejectedValue(new Error('boom'))

    await expect(runBackupRestoreGate()).resolves.toBeUndefined()

    expect(markRestoreFailedAfterCrashMock).toHaveBeenCalledOnce()
  })

  it('never throws on a crash-net failure while the live DB survived', async () => {
    runRestorePromotionMock.mockRejectedValue(new Error('boom'))
    markRestoreFailedAfterCrashMock.mockImplementation(() => {
      throw new Error('disk full')
    })

    await expect(runBackupRestoreGate()).resolves.toBeUndefined()
  })

  it('refuses to boot when recovery left the live DB stranded in the aside', async () => {
    runRestorePromotionMock.mockRejectedValue(new Error('boom'))
    isLiveDbStrandedMock.mockReturnValue(true)

    // Booting on would create a fresh empty database while the user's data
    // sits in the aside — the one case worse than the fail-fast dialog.
    await expect(runBackupRestoreGate()).rejects.toThrow(/empty database/)
  })

  it('refuses to boot while any durable recovery direction is incomplete', async () => {
    runRestorePromotionMock.mockRejectedValue(new Error('resource rename failed'))
    isRestoreRollbackPendingMock.mockReturnValue(true)

    await expect(runBackupRestoreGate()).rejects.toThrow(/mixed restore state/)
  })

  it('refuses to boot when the crash net itself failed and the live DB is stranded', async () => {
    runRestorePromotionMock.mockRejectedValue(new Error('boom'))
    markRestoreFailedAfterCrashMock.mockImplementation(() => {
      throw new Error('EBUSY: aside rename blocked')
    })
    isLiveDbStrandedMock.mockReturnValue(true)

    await expect(runBackupRestoreGate()).rejects.toThrow(/empty database/)
  })
})
