import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { hasPendingRestore } from '@data/db/restore/restoreGuard'
import type { RestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { readRestoreJournalV2, writeRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { acknowledgeRestore } from '../acknowledgeRestore'

/**
 * Acknowledgement is the only thing that lets go of a restore's rollback
 * material, so the assertions are about ORDER and IDEMPOTENCE, not about the
 * unlink itself: while the journal exists the asides are protected, so the
 * journal must be the last thing to go — and every prefix of the sequence must
 * be safe to re-run after a crash.
 */

let userData = ''

vi.mock('@application', () => ({
  application: {
    getPath: vi.fn((key: string) => {
      const bases: Record<string, string> = {
        'app.userdata': userData,
        'feature.backup.restore.file': join(userData, 'restore-journal.json'),
        'feature.backup.restore.staging': join(userData, 'restore-staging')
      }
      const base = bases[key]
      if (!base) throw new Error(`Unexpected path key in acknowledgeRestore test: ${key}`)
      return base
    })
  }
}))

const RID = '11111111-2222-4333-8444-555555555555'
const asideRel = `cherrystudio.sqlite.pre-restore-${RID}`

function journal(overrides: Record<string, unknown> = {}): RestoreJournalV2 {
  return {
    version: 2,
    restoreId: RID,
    preset: 'lite',
    createdAt: '2026-07-27T00:00:00.000Z',
    state: 'completed',
    step: 'integrity-ok',
    summary: { knowledgeBaseIds: [] },
    db: {
      promote: `restore-staging/${RID}/backup.sqlite`,
      aside: asideRel,
      chain: [{ folderMillis: 1_730_000_000_000, hash: 'hash-one' }]
    },
    resourceInstalls: [],
    ...overrides
  } as RestoreJournalV2
}

describe('acknowledgeRestore', () => {
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'cs-ack-'))
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('removes the database aside and clears the journal', () => {
    writeFileSync(join(userData, asideRel), 'PREVIOUS-DB')
    writeRestoreJournalV2(journal())

    const result = acknowledgeRestore()

    expect(result).toMatchObject({ acknowledged: true, restoreId: RID })
    expect(existsSync(join(userData, asideRel))).toBe(false)
    expect(readRestoreJournalV2().kind).toBe('none')
  })

  it('releases GC protection only once the asides are gone', () => {
    writeFileSync(join(userData, asideRel), 'PREVIOUS-DB')
    writeRestoreJournalV2(journal())
    // A completed-but-unacknowledged restore still owns storage (§6.5).
    expect(hasPendingRestore()).toBe(true)

    acknowledgeRestore()

    expect(hasPendingRestore()).toBe(false)
  })

  it('is idempotent, so a crash mid-cleanup is resumable by calling it again', () => {
    writeFileSync(join(userData, asideRel), 'PREVIOUS-DB')
    writeRestoreJournalV2(journal())

    acknowledgeRestore()
    const second = acknowledgeRestore()

    expect(second).toEqual({ acknowledged: false, removed: 0 })
  })

  it('survives an aside that a previous attempt already removed', () => {
    // The crash window: asides gone, journal still there. Protection was still
    // on the whole time, and this call must finish the job rather than throw.
    writeRestoreJournalV2(journal())

    expect(acknowledgeRestore()).toEqual({ acknowledged: true, restoreId: RID, removed: 0 })
    expect(readRestoreJournalV2().kind).toBe('none')
  })

  it('removes resource asides and the forensic park alongside the database aside', () => {
    mkdirSync(join(userData, 'restore-aside'), { recursive: true })
    writeFileSync(join(userData, 'restore-aside', 'blob-1'), 'OLD-BLOB')
    writeFileSync(join(userData, asideRel), 'PREVIOUS-DB')
    // Left by a post-commit revert; nothing else knows this restoreId.
    writeFileSync(join(userData, `restore-failed-${RID}.sqlite`), 'REJECTED-DB')
    writeRestoreJournalV2(
      journal({
        preset: 'full',
        resourceInstalls: [
          {
            resourceType: 'file',
            staging: `restore-staging/${RID}/files/blob-1`,
            live: 'Data/Files/blob-1',
            aside: 'restore-aside/blob-1'
          }
        ]
      })
    )

    const result = acknowledgeRestore()

    expect(result.removed).toBe(3)
    expect(existsSync(join(userData, 'restore-aside', 'blob-1'))).toBe(false)
    expect(existsSync(join(userData, `restore-failed-${RID}.sqlite`))).toBe(false)
  })

  it.each(['failed', 'expired'] as const)('acknowledges the terminal state %s too', (state) => {
    writeFileSync(join(userData, asideRel), 'PREVIOUS-DB')
    writeRestoreJournalV2(journal({ state, step: undefined, summary: undefined }))

    expect(acknowledgeRestore().acknowledged).toBe(true)
    expect(readRestoreJournalV2().kind).toBe('none')
  })

  it.each(['prepared', 'armed'] as const)('refuses to acknowledge an unfinished restore (%s)', (state) => {
    writeFileSync(join(userData, asideRel), 'PREVIOUS-DB')
    writeRestoreJournalV2(journal({ state, step: undefined, summary: undefined }))

    // Releasing protection here would drop the aside a promotion is about to
    // need, and the sweep would run against a database still being replaced.
    expect(() => acknowledgeRestore()).toThrow(/has not finished/)
    expect(existsSync(join(userData, asideRel))).toBe(true)
    expect(hasPendingRestore()).toBe(true)
  })

  it('refuses to guess at an unreadable journal', () => {
    writeFileSync(join(userData, 'restore-journal.json'), '{ not json')

    expect(() => acknowledgeRestore()).toThrow(/unreadable/)
    expect(hasPendingRestore()).toBe(true)
  })
})
