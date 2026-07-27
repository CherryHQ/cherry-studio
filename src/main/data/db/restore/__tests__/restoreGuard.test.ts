import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { hasPendingRestore } from '@data/db/restore/restoreGuard'
import type { RestoreJournalV2, RestoreJournalV2State } from '@data/db/restore/restoreJournalV2'
import { writeRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The reclaim guard is what stands between a running restore and the orphan
 * sweep's `unlink`, so every state is asserted individually rather than through
 * the aggregate predicate — a rule that silently collapsed two states into one
 * answer would still pass a "returns true for a pending restore" test.
 */
let userDataDir = ''

vi.mock('@application', () => ({
  application: {
    getPath: vi.fn((key: string) => {
      if (key !== 'feature.backup.restore.file') {
        throw new Error(`Unexpected path key in restoreGuard test: ${key}`)
      }
      return join(userDataDir, 'restore-journal.json')
    })
  }
}))

function journalPath(): string {
  return join(userDataDir, 'restore-journal.json')
}

function v2Journal(state: RestoreJournalV2State): RestoreJournalV2 {
  const base = {
    version: 2 as const,
    restoreId: '11111111-2222-4333-8444-555555555555',
    preset: 'lite' as const,
    createdAt: '2026-07-27T00:00:00.000Z',
    db: {
      promote: 'restore-staging/backup.sqlite',
      aside: 'cherrystudio.sqlite.pre-restore',
      chain: [{ folderMillis: 1_730_000_000_000, hash: 'hash-one' }]
    },
    resourceInstalls: []
  }

  switch (state) {
    case 'promoting':
      return { ...base, state, step: 'live-aside' }
    case 'completed':
      return { ...base, state, step: 'integrity-ok', summary: { knowledgeBaseIds: [] } }
    default:
      return { ...base, state }
  }
}

describe('hasPendingRestore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'cs-restore-guard-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns false when no journal exists', () => {
    expect(hasPendingRestore()).toBe(false)
  })

  describe('journal v2', () => {
    it.each([
      ['prepared', true],
      ['armed', true],
      ['promoting', true]
    ] as const)('protects storage in the non-terminal state %s', (state, expected) => {
      writeRestoreJournalV2(v2Journal(state))

      expect(hasPendingRestore()).toBe(expected)
    })

    it('keeps protecting a completed restore, whose asides survive until acknowledgement', () => {
      // §6.5: acknowledgement cleanup removes asides FIRST and clears the
      // journal LAST, so a `completed` journal on disk proves the asides are
      // still there. Sweeping now would unlink what the rollback path needs.
      writeRestoreJournalV2(v2Journal('completed'))

      expect(hasPendingRestore()).toBe(true)
    })

    it.each([
      ['failed', false],
      ['expired', false]
    ] as const)('releases protection in the terminal state %s', (state, expected) => {
      writeRestoreJournalV2(v2Journal(state))

      expect(hasPendingRestore()).toBe(expected)
    })
  })

  it('protects storage when the journal cannot be parsed', () => {
    writeFileSync(journalPath(), '{ not json')

    expect(hasPendingRestore()).toBe(true)
  })
})
