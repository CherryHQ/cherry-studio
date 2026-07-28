import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { RestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { readRestoreJournalV2, writeRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { relaunchMock } = vi.hoisted(() => ({
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
    relaunch: relaunchMock
  }
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
    preset: 'lite',
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
    relaunchMock.mockReset()
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('durably arms a completed restore before requesting relaunch', () => {
    writeRestoreJournalV2(completedJournal())

    armRestoreRollback()

    expect(readRestoreJournalV2()).toMatchObject({
      kind: 'ok',
      journal: { state: 'rollback-armed' }
    })
    expect(relaunchMock).toHaveBeenCalledOnce()
  })

  it('refuses a restore that has not completed', () => {
    writeRestoreJournalV2({
      ...completedJournal(),
      state: 'prepared'
    } as RestoreJournalV2)

    expect(() => armRestoreRollback()).toThrowError(RestoreStateError)
    expect(relaunchMock).not.toHaveBeenCalled()
  })

  it('refuses while completed resources are still being repaired', () => {
    writeRestoreJournalV2(completedJournal({ resourcesIncomplete: true }))

    expect(() => armRestoreRollback()).toThrowError(
      expect.objectContaining<Partial<RestoreStateError>>({
        code: 'recovery-incomplete'
      })
    )
    expect(relaunchMock).not.toHaveBeenCalled()
  })

  it('refuses to arm after acknowledgement already removed the rollback database', () => {
    writeRestoreJournalV2(completedJournal())
    rmSync(join(userData, `cherrystudio.sqlite.pre-restore-${RESTORE_ID}`))

    expect(() => armRestoreRollback()).toThrowError(
      expect.objectContaining<Partial<RestoreStateError>>({ code: 'rollback-unavailable' })
    )
    expect(readRestoreJournalV2()).toMatchObject({ kind: 'ok', journal: { state: 'completed' } })
    expect(relaunchMock).not.toHaveBeenCalled()
  })

  it('restores completed when relaunch initiation fails', () => {
    writeRestoreJournalV2(completedJournal())
    relaunchMock.mockImplementation(() => {
      throw new Error('relaunch unavailable')
    })

    expect(() => armRestoreRollback()).toThrowError(
      expect.objectContaining<Partial<RestoreStateError>>({
        code: 'relaunch-failed'
      })
    )
    expect(readRestoreJournalV2()).toMatchObject({
      kind: 'ok',
      journal: { state: 'completed' }
    })
  })
})
