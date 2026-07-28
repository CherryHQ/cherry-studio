import { describe, expect, it } from 'vitest'

import { DB_COMMIT_STEP, parseRestoreJournal, PROMOTION_STEP_ORDER, RestoreJournalSchema } from '../restoreJournal'

const restoreId = '11111111-2222-4333-8444-555555555555'
const journal = {
  version: 2 as const,
  restoreId,
  createdAt: '2026-07-27T00:00:00.000Z',
  state: 'prepared' as const,
  db: {
    promote: `restore-staging/${restoreId}/backup.sqlite`,
    aside: `Data/cherrystudio.sqlite.pre-restore-${restoreId}`,
    chain: [{ folderMillis: 1, hash: 'one' }]
  }
}

describe('RestoreJournalSchema', () => {
  it('accepts every final database-only lifecycle state', () => {
    expect(RestoreJournalSchema.safeParse(journal).success).toBe(true)
    expect(RestoreJournalSchema.safeParse({ ...journal, state: 'armed' }).success).toBe(true)
    expect(RestoreJournalSchema.safeParse({ ...journal, state: 'promoting', step: 'live-aside' }).success).toBe(true)
    expect(
      RestoreJournalSchema.safeParse({ ...journal, state: 'reverting', step: 'db-promoted', reason: 'integrity' })
        .success
    ).toBe(true)
    for (const state of ['completed', 'rollback-armed', 'rolled-back', 'failed', 'expired'] as const) {
      expect(RestoreJournalSchema.safeParse({ ...journal, state }).success).toBe(true)
    }
  })

  it('fails closed on version, shape, or unknown fields it does not own', () => {
    expect(parseRestoreJournal({ ...journal, version: 1 }).kind).toBe('invalid')
    expect(parseRestoreJournal({ ...journal, preset: 'lite' }).kind).toBe('invalid')
    expect(parseRestoreJournal({ ...journal, unexpected: [] }).kind).toBe('invalid')
    expect(parseRestoreJournal({ ...journal, state: 'promoting' }).kind).toBe('invalid')
    expect(parseRestoreJournal({ ...journal, db: { ...journal.db, chain: [] } }).kind).toBe('invalid')
  })

  it('orders checkpoint and sidecar removal before the database commit', () => {
    expect(PROMOTION_STEP_ORDER.indexOf('live-checkpointed')).toBeLessThan(PROMOTION_STEP_ORDER.indexOf(DB_COMMIT_STEP))
    expect(PROMOTION_STEP_ORDER.indexOf('sidecars-removed')).toBeLessThan(PROMOTION_STEP_ORDER.indexOf(DB_COMMIT_STEP))
  })
})
