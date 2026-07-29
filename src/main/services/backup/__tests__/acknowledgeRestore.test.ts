import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { hasPendingRestore } from '@data/db/restore/restoreGuard'
import type { RestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { readRestoreJournalV2, writeRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { abandonKnowledgeRebuild, acknowledgeRestore } from '../acknowledgeRestore'

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
        'app.database.file': join(userData, 'cherrystudio.sqlite'),
        'feature.backup.restore.file': join(userData, 'restore-journal.json'),
        'feature.backup.restore.staging': join(userData, 'restore-staging'),
        'feature.backup.restore.aside': join(userData, 'restore-aside')
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
    preset: 'full',
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

    expect(acknowledgeRestore()).toEqual({
      acknowledged: true,
      restoreId: RID,
      removed: 0
    })
    expect(readRestoreJournalV2().kind).toBe('none')
  })

  it('removes resource asides and the forensic park alongside the database aside', () => {
    mkdirSync(join(userData, 'restore-aside', RID), { recursive: true })
    writeFileSync(join(userData, 'restore-aside', RID, 'blob-1'), 'OLD-BLOB')
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
            aside: `restore-aside/${RID}/blob-1`
          }
        ]
      })
    )

    const result = acknowledgeRestore()

    expect(result.removed).toBe(3)
    expect(existsSync(join(userData, 'restore-aside', RID, 'blob-1'))).toBe(false)
    expect(existsSync(join(userData, `restore-failed-${RID}.sqlite`))).toBe(false)
  })

  it('acknowledges a completed rollback and releases the displaced restored side', () => {
    mkdirSync(join(userData, 'restore-staging', RID), { recursive: true })
    writeFileSync(join(userData, 'restore-staging', RID, 'restored-resource'), 'RESTORED')
    writeFileSync(join(userData, `restore-failed-${RID}.sqlite`), 'RESTORED-DB')
    writeRestoreJournalV2(journal({ state: 'rolled-back', step: undefined }))

    expect(acknowledgeRestore()).toMatchObject({
      acknowledged: true,
      removed: 2
    })
    expect(existsSync(join(userData, `restore-failed-${RID}.sqlite`))).toBe(false)
    expect(existsSync(join(userData, 'restore-staging', RID))).toBe(false)
    expect(readRestoreJournalV2().kind).toBe('none')
  })

  it.each(['failed', 'expired'] as const)('acknowledges the terminal state %s too', (state) => {
    writeFileSync(join(userData, asideRel), 'PREVIOUS-DB')
    writeRestoreJournalV2(journal({ state, step: undefined, summary: undefined }))

    expect(acknowledgeRestore().acknowledged).toBe(true)
    expect(readRestoreJournalV2().kind).toBe('none')
  })

  it.each(['prepared', 'armed', 'rollback-armed'] as const)(
    'refuses to acknowledge an unfinished restore (%s)',
    (state) => {
      writeFileSync(join(userData, asideRel), 'PREVIOUS-DB')
      writeRestoreJournalV2(
        journal({
          state,
          step: undefined,
          ...(state === 'rollback-armed' ? {} : { summary: undefined })
        })
      )

      // Releasing protection here would drop the aside a promotion is about to
      // need, and the sweep would run against a database still being replaced.
      expect(() => acknowledgeRestore()).toThrow(/has not finished/)
      expect(existsSync(join(userData, asideRel))).toBe(true)
      expect(hasPendingRestore()).toBe(true)
    }
  )

  it('refuses to release asides a rollback could not put back yet', () => {
    writeFileSync(join(userData, asideRel), 'PREVIOUS-DB')
    mkdirSync(join(userData, 'restore-aside', RID), { recursive: true })
    writeFileSync(join(userData, 'restore-aside', RID, 'blob-1'), 'ORIGINAL-BLOB')
    writeRestoreJournalV2(
      journal({
        state: 'failed',
        step: undefined,
        summary: undefined,
        recoveryIncomplete: true,
        preset: 'full',
        resourceInstalls: [
          {
            resourceType: 'file',
            staging: `restore-staging/${RID}/files/blob-1`,
            live: 'Data/Files/blob-1',
            aside: `restore-aside/${RID}/blob-1`
          }
        ]
      })
    )

    // These are not spent rollback material — they are the originals the repair
    // still needs. The refusal is temporary: the next boot retries the rollback
    // and clears the marker.
    expect(() => acknowledgeRestore()).toThrow(/could not put every file back/)
    expect(existsSync(join(userData, asideRel))).toBe(true)
    expect(existsSync(join(userData, 'restore-aside', RID, 'blob-1'))).toBe(true)
    expect(hasPendingRestore()).toBe(true)
  })

  it('refuses to release a unit a completed restore has not put in place yet', () => {
    writeFileSync(join(userData, asideRel), 'PREVIOUS-DB')
    mkdirSync(join(userData, 'restore-aside', RID), { recursive: true })
    writeFileSync(join(userData, 'restore-aside', RID, 'blob-1'), 'ORIGINAL-BLOB')
    mkdirSync(join(userData, 'restore-staging', RID, 'files'), {
      recursive: true
    })
    writeFileSync(join(userData, 'restore-staging', RID, 'files', 'blob-1'), 'RESTORED-BLOB')
    writeRestoreJournalV2(
      journal({
        resourcesIncomplete: true,
        preset: 'full',
        resourceInstalls: [
          {
            resourceType: 'file',
            staging: `restore-staging/${RID}/files/blob-1`,
            live: 'Data/Files/blob-1',
            aside: `restore-aside/${RID}/blob-1`
          }
        ]
      })
    )

    // The database is live, but this unit exists ONLY in the staging tree and
    // its aside — the two things acknowledgement deletes. Releasing them would
    // leave the user with neither copy.
    expect(() => acknowledgeRestore()).toThrow(/could not put every file in place/)
    expect(existsSync(join(userData, 'restore-aside', RID, 'blob-1'))).toBe(true)
    expect(existsSync(join(userData, 'restore-staging', RID, 'files', 'blob-1'))).toBe(true)
    expect(hasPendingRestore()).toBe(true)
  })

  it('keeps the durable retry marker until every restored Knowledge base is rebuilt', () => {
    writeFileSync(join(userData, asideRel), 'PREVIOUS-DB')
    writeRestoreJournalV2(journal({ summary: { knowledgeBaseIds: ['kb-1'] } }))

    expect(() => acknowledgeRestore()).toThrow(/knowledge index is still rebuilding/)
    expect(existsSync(join(userData, asideRel))).toBe(true)
    expect(hasPendingRestore()).toBe(true)

    writeRestoreJournalV2(
      journal({
        summary: { knowledgeBaseIds: ['kb-1'] },
        knowledgeRebuild: { completedBaseIds: ['kb-1'] }
      })
    )
    expect(acknowledgeRestore().acknowledged).toBe(true)
  })

  it('durably records an explicit rebuild give-up and then releases rollback material', () => {
    writeFileSync(join(userData, asideRel), 'PREVIOUS-DB')
    writeRestoreJournalV2(journal({ summary: { knowledgeBaseIds: ['kb-1', 'kb-2'] } }))

    expect(abandonKnowledgeRebuild()).toEqual({ restoreId: RID, pendingBaseIds: ['kb-1', 'kb-2'] })
    const read = readRestoreJournalV2()
    expect(read).toMatchObject({
      kind: 'ok',
      journal: { knowledgeRebuild: { completedBaseIds: [], abandoned: true } }
    })
    expect(acknowledgeRestore().acknowledged).toBe(true)
    expect(existsSync(join(userData, asideRel))).toBe(false)
  })

  /**
   * Acknowledgement is a recursive delete driven by a file that outlives the app
   * process, so it re-proves the path it is about to follow at the moment it
   * follows it. Each case puts the interloper on the LAST artifact: the earlier
   * ones are already gone by then, which is precisely the state the retry has to
   * survive.
   */
  describe('release safety', () => {
    /** Something outside userData that must still be there afterwards. */
    function outside(): string {
      const target = mkdtempSync(join(tmpdir(), 'cs-ack-outside-'))
      writeFileSync(join(target, 'someone-elses.txt'), 'NOT OURS')
      return target
    }

    it('refuses to follow a symlinked ancestor into another tree, and finishes on retry', () => {
      const external = outside()
      mkdirSync(join(external, RID), { recursive: true })
      writeFileSync(join(userData, asideRel), 'PREVIOUS-DB')
      symlinkSync(external, join(userData, 'restore-staging'))
      writeRestoreJournalV2(journal())

      expect(() => acknowledgeRestore()).toThrow(/no longer where this restore left it/)
      // The refusal came last: the database aside was already released, and the
      // journal — the retry's only anchor — is still there.
      expect(existsSync(join(external, 'someone-elses.txt'))).toBe(true)
      expect(existsSync(join(external, RID))).toBe(true)
      expect(existsSync(join(userData, asideRel))).toBe(false)
      expect(hasPendingRestore()).toBe(true)

      rmSync(join(userData, 'restore-staging'))
      expect(acknowledgeRestore()).toMatchObject({ acknowledged: true })
      expect(readRestoreJournalV2().kind).toBe('none')
      rmSync(external, { recursive: true, force: true })
    })

    it('refuses when an artifact itself has become a symlink', () => {
      const external = outside()
      writeFileSync(join(userData, asideRel), 'PREVIOUS-DB')
      symlinkSync(join(external, 'someone-elses.txt'), join(userData, `restore-failed-${RID}.sqlite`))
      writeRestoreJournalV2(journal())

      expect(() => acknowledgeRestore()).toThrow(/no longer where this restore left it/)
      expect(existsSync(join(external, 'someone-elses.txt'))).toBe(true)
      expect(hasPendingRestore()).toBe(true)
      rmSync(external, { recursive: true, force: true })
    })

    it('refuses a journal whose park slots belong to some other restore', () => {
      writeFileSync(join(userData, asideRel), 'PREVIOUS-DB')
      writeRestoreJournalV2(
        journal({
          preset: 'full',
          resourceInstalls: [
            {
              resourceType: 'file',
              staging: `restore-staging/${RID}/files/blob-1`,
              live: 'Data/Files/blob-2',
              aside: 'Data/Files/blob-1'
            }
          ]
        })
      )

      // Nothing is deleted: ownership is proven for the whole set before the
      // first unlink, so a journal pointing at live data cannot delete any of it.
      expect(() => acknowledgeRestore()).toThrow(/does not belong to this restore/)
      expect(existsSync(join(userData, asideRel))).toBe(true)
      expect(hasPendingRestore()).toBe(true)
    })

    it('refuses a journal whose database park slot is not the one this device would use', () => {
      writeFileSync(join(userData, asideRel), 'PREVIOUS-DB')
      writeRestoreJournalV2(journal({ db: { ...journal().db, aside: 'cherrystudio.sqlite' } }))

      expect(() => acknowledgeRestore()).toThrow(/park slot/)
      expect(hasPendingRestore()).toBe(true)
    })

    it('refuses to acknowledge a restore that is still reverting', () => {
      writeFileSync(join(userData, asideRel), 'PREVIOUS-DB')
      writeRestoreJournalV2(journal({ state: 'reverting', summary: undefined, reason: 'db-corrupt' }))

      expect(() => acknowledgeRestore()).toThrow(/has not finished/)
      expect(existsSync(join(userData, asideRel))).toBe(true)
      expect(hasPendingRestore()).toBe(true)
    })
  })

  it('refuses to guess at an unreadable journal', () => {
    writeFileSync(join(userData, 'restore-journal.json'), '{ not json')

    expect(() => acknowledgeRestore()).toThrow(/unreadable/)
    expect(hasPendingRestore()).toBe(true)
  })
})
