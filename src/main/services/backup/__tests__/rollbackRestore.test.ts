import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { RestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { readRestoreJournalV2, writeRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { forceExitMock, holdDisposeMock, relaunchMock } = vi.hoisted(() => ({
  forceExitMock: vi.fn(),
  holdDisposeMock: vi.fn(),
  relaunchMock: vi.fn<() => void>()
}))
let userData = ''

vi.mock('@application', () => ({
  application: {
    getPath: vi.fn((key: string, filename?: string) => {
      const base =
        key === 'feature.backup.restore.file'
          ? join(userData, 'restore-journal.json')
          : key === 'app.userdata'
            ? userData
            : undefined
      if (!base) throw new Error(`unexpected path key: ${key}`)
      return filename ? join(base, filename) : base
    }),
    forceExit: forceExitMock,
    relaunch: relaunchMock
  }
}))

vi.mock('../exportQuiesce', () => ({
  acquireProfileQuiescence: vi.fn(async () => ({
    checkpoint: vi.fn(),
    dispose: holdDisposeMock,
    signal: new AbortController().signal,
    waitFor: vi.fn()
  }))
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

import { RestoreStateError } from '../errors'
import { armRestoreRollback } from '../rollbackRestore'

const RESTORE_ID = '11111111-2222-4333-8444-555555555555'

function completedJournal(
  overrides: Partial<Extract<RestoreJournalV2, { state: 'completed' }>> = {}
): RestoreJournalV2 {
  return {
    version: 2,
    restoreId: RESTORE_ID,
    preset: 'full',
    createdAt: '2026-07-27T00:00:00.000Z',
    state: 'completed',
    db: {
      promote: `restore-staging/${RESTORE_ID}/backup.sqlite`,
      aside: `cherrystudio.sqlite.pre-restore-${RESTORE_ID}`,
      chain: [{ folderMillis: 1_730_000_000_000, hash: 'hash-one' }]
    },
    resourceInstalls: [],
    summary: { knowledgeBaseIds: [] },
    ...overrides
  }
}

describe('armRestoreRollback', () => {
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'cs-rollback-arm-'))
    writeFileSync(join(userData, `cherrystudio.sqlite.pre-restore-${RESTORE_ID}`), 'PREVIOUS')
    forceExitMock.mockReset()
    holdDisposeMock.mockReset()
    relaunchMock.mockReset()
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('durably arms a completed restore before requesting relaunch', async () => {
    writeRestoreJournalV2(completedJournal())
    let stateAtRelaunch: string | undefined
    relaunchMock.mockImplementationOnce(() => {
      const read = readRestoreJournalV2()
      stateAtRelaunch = read.kind === 'ok' ? read.journal.state : read.kind
    })

    await armRestoreRollback()

    expect(readRestoreJournalV2()).toMatchObject({
      kind: 'ok',
      journal: { state: 'rollback-armed' }
    })
    expect(stateAtRelaunch).toBe('rollback-armed')
    expect(relaunchMock).toHaveBeenCalledOnce()
  })

  it('refuses a restore that has not completed', async () => {
    writeRestoreJournalV2({
      ...completedJournal(),
      state: 'prepared'
    } as RestoreJournalV2)

    await expect(armRestoreRollback()).rejects.toThrowError(RestoreStateError)
    expect(relaunchMock).not.toHaveBeenCalled()
  })

  it('refuses while completed resources are still being repaired', async () => {
    writeRestoreJournalV2(completedJournal({ resourcesIncomplete: true }))

    await expect(armRestoreRollback()).rejects.toThrowError(
      expect.objectContaining<Partial<RestoreStateError>>({
        code: 'recovery-incomplete'
      })
    )
    expect(relaunchMock).not.toHaveBeenCalled()
  })

  it('refuses to arm after acknowledgement already removed the rollback database', async () => {
    writeRestoreJournalV2(completedJournal())
    rmSync(join(userData, `cherrystudio.sqlite.pre-restore-${RESTORE_ID}`))

    await expect(armRestoreRollback()).rejects.toThrowError(
      expect.objectContaining<Partial<RestoreStateError>>({ code: 'rollback-unavailable' })
    )
    expect(readRestoreJournalV2()).toMatchObject({ kind: 'ok', journal: { state: 'completed' } })
    expect(relaunchMock).not.toHaveBeenCalled()
  })

  /**
   * Arming is the last moment a rollback can still be refused for free. Once the
   * journal says `rollback-armed`, preboot must carry the reverse pass out, and
   * a unit whose aside vanished is discovered with earlier units already moved.
   */
  describe('resource topology', () => {
    /** A journal unit as an older build wrote it: without the field it never recorded. */
    function withoutHadLive<T extends object>(unit: T): Omit<T, 'hadLive'> {
      const copy = { ...unit } as Record<string, unknown>
      delete copy.hadLive
      return copy as Omit<T, 'hadLive'>
    }

    /** Two replaced units, exactly as a completed restore leaves them. */
    function replacedUnits(): RestoreJournalV2['resourceInstalls'] {
      return [0, 1].map((index) => ({
        resourceType: 'directory' as const,
        staging: `restore-staging/${RESTORE_ID}/resources/Data/KnowledgeBase/base-${index}`,
        live: `Data/KnowledgeBase/base-${index}`,
        aside: `restore-aside/${RESTORE_ID}/${index}-base-${index}`,
        hadLive: true
      }))
    }

    function makeDir(relative: string): void {
      mkdirSync(join(userData, ...relative.split('/')), { recursive: true })
    }

    function arrangeCompleted(units: RestoreJournalV2['resourceInstalls']): void {
      for (const unit of units) {
        makeDir(unit.live)
        if (unit.hadLive) makeDir(unit.aside)
      }
      writeRestoreJournalV2(completedJournal({ resourceInstalls: units }))
    }

    it('arms when every unit is where completion left it', async () => {
      arrangeCompleted(replacedUnits())

      await armRestoreRollback()

      expect(readRestoreJournalV2()).toMatchObject({ kind: 'ok', journal: { state: 'rollback-armed' } })
    })

    it('refuses when the LAST unit lost the aside holding its pre-restore copy', async () => {
      const units = replacedUnits()
      arrangeCompleted(units)
      rmSync(join(userData, ...units[1].aside.split('/')), { recursive: true })

      await expect(armRestoreRollback()).rejects.toThrowError(
        expect.objectContaining<Partial<RestoreStateError>>({ code: 'rollback-unavailable' })
      )
      // Nothing was armed and nothing moved: the first unit, whose own aside is
      // intact, is still untouched rather than half-reversed.
      expect(readRestoreJournalV2()).toMatchObject({ kind: 'ok', journal: { state: 'completed' } })
      expect(existsSync(join(userData, ...units[0].aside.split('/')))).toBe(true)
      expect(existsSync(join(userData, ...units[0].live.split('/')))).toBe(true)
      expect(relaunchMock).not.toHaveBeenCalled()
    })

    it('refuses when a unit that replaced nothing somehow has an aside', async () => {
      const units = replacedUnits().map((unit) => ({ ...unit, hadLive: false }))
      arrangeCompleted(units)
      makeDir(units[0].aside)

      await expect(armRestoreRollback()).rejects.toThrowError(
        expect.objectContaining<Partial<RestoreStateError>>({ code: 'rollback-unavailable' })
      )
      expect(relaunchMock).not.toHaveBeenCalled()
    })

    it('refuses when the restored node is gone from its live slot', async () => {
      const units = replacedUnits()
      arrangeCompleted(units)
      rmSync(join(userData, ...units[0].live.split('/')), { recursive: true })

      await expect(armRestoreRollback()).rejects.toThrowError(
        expect.objectContaining<Partial<RestoreStateError>>({ code: 'rollback-unavailable' })
      )
      expect(relaunchMock).not.toHaveBeenCalled()
    })

    it('refuses a journal from a build that never recorded what each unit replaced', async () => {
      const units = replacedUnits().map(withoutHadLive)
      arrangeCompleted(units)

      // The app still starts and the restore stays usable — only this one
      // irreversible action is withheld.
      await expect(armRestoreRollback()).rejects.toThrowError(
        expect.objectContaining<Partial<RestoreStateError>>({ code: 'rollback-unavailable' })
      )
      expect(readRestoreJournalV2()).toMatchObject({ kind: 'ok', journal: { state: 'completed' } })
      expect(relaunchMock).not.toHaveBeenCalled()
    })
  })

  it('restores completed when relaunch initiation fails', async () => {
    writeRestoreJournalV2(completedJournal())
    relaunchMock.mockImplementation(() => {
      throw new Error('relaunch unavailable')
    })

    await expect(armRestoreRollback()).rejects.toThrowError(
      expect.objectContaining<Partial<RestoreStateError>>({
        code: 'relaunch-failed'
      })
    )
    expect(readRestoreJournalV2()).toMatchObject({
      kind: 'ok',
      journal: { state: 'completed' }
    })
    expect(holdDisposeMock).toHaveBeenCalledOnce()
  })
})
