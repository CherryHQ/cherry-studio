import { describe, expect, it } from 'vitest'

import {
  DB_COMMIT_STEP,
  parseRestoreJournalV2,
  PROMOTION_STEP_ORDER_V2,
  RESTORE_JOURNAL_VERSION,
  RestoreJournalV2Schema
} from '../restoreJournalV2'
import { MAX_JOURNAL_DEGRADATIONS, MAX_RESOURCE_INSTALL_ENTRIES } from '../restoreLimits'

const chain = [{ folderMillis: 1_700_000_000_000, hash: 'h1' }]
const UUID = '11111111-2222-4333-8444-555555555555'
const summary = { knowledgeBaseIds: [] as string[] }
const ownerSummary = { knowledge: { baseIds: [] as string[], requiresRebuild: false } }

/** A valid journal with no resource installs. */
function baseJournal(overrides: Record<string, unknown> = {}) {
  return {
    version: RESTORE_JOURNAL_VERSION,
    restoreId: UUID,
    preset: 'full' as const,
    createdAt: '2026-07-27T00:00:00.000Z',
    db: { promote: 'restore-staging/work.sqlite', aside: 'db.sqlite.aside', chain },
    resourceInstalls: [],
    state: 'prepared' as const,
    ...overrides
  }
}

function fullInstall() {
  return {
    resourceType: 'directory' as const,
    staging: 'restore-staging/kb/base-1',
    live: 'Data/KnowledgeBase/base-1',
    aside: 'restore-staging/aside/base-1'
  }
}

function fullJournal(overrides: Record<string, unknown> = {}) {
  return { ...baseJournal(), resourceInstalls: [fullInstall()], ...overrides }
}

describe('RestoreJournalV2Schema — versions & states', () => {
  it('accepts every lifecycle state', () => {
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ state: 'prepared' })).success).toBe(true)
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ state: 'armed' })).success).toBe(true)
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ state: 'promoting', step: 'db-promoted' })).success).toBe(
      true
    )
    expect(
      RestoreJournalV2Schema.safeParse(
        baseJournal({ state: 'reverting', step: 'db-promoted', reason: 'integrity check failed' })
      ).success
    ).toBe(true)
    expect(
      RestoreJournalV2Schema.safeParse(baseJournal({ state: 'completed', step: 'integrity-ok', summary })).success
    ).toBe(true)
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ state: 'completed', summary })).success).toBe(true)
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ state: 'rollback-armed', summary })).success).toBe(true)
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ state: 'rolled-back', summary })).success).toBe(true)
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ state: 'failed' })).success).toBe(true)
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ state: 'expired' })).success).toBe(true)
  })

  it('requires a step for active directions and rejects unknown steps/states', () => {
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ state: 'promoting' })).success).toBe(false)
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ state: 'promoting', step: 'not-a-step' })).success).toBe(
      false
    )
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ state: 'reverting', reason: 'failed' })).success).toBe(false)
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ state: 'staged' })).success).toBe(false)
  })

  it('pins the version literal to 2', () => {
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ version: 1 })).success).toBe(false)
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ version: 3 })).success).toBe(false)
  })

  it('rejects unknown top-level fields (strict)', () => {
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ extra: true })).success).toBe(false)
  })

  it('rejects a fingerprint field on db (v2 dropped it)', () => {
    const j = baseJournal()
    ;(j.db as Record<string, unknown>).fingerprint = 'deadbeef'
    expect(RestoreJournalV2Schema.safeParse(j).success).toBe(false)
  })

  it('requires a complete (non-empty) migration chain', () => {
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ db: { promote: 'a', aside: 'b', chain: [] } })).success).toBe(
      false
    )
  })

  it('rejects absolute / escaping resource-install paths', () => {
    const bad = { ...fullInstall(), live: '/etc/passwd' }
    const j = { ...baseJournal(), preset: 'full' as const, resourceInstalls: [bad] }
    expect(RestoreJournalV2Schema.safeParse(j).success).toBe(false)
  })

  it('requires restoreId to be a UUID', () => {
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ restoreId: 'restore-1' })).success).toBe(false)
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ restoreId: UUID })).success).toBe(true)
  })

  it('requires an ISO-8601 datetime createdAt', () => {
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ createdAt: 'now' })).success).toBe(false)
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ createdAt: '2026-07-27' })).success).toBe(false)
  })
})

describe('RestoreJournalV2Schema — terminal fields', () => {
  it.each(['completed', 'rollback-armed', 'rolled-back'] as const)('requires a durable summary on %s', (state) => {
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ state })).success).toBe(false)
    expect(
      RestoreJournalV2Schema.safeParse(baseJournal({ state, summary: { knowledgeBaseIds: ['kb-1'] } })).success
    ).toBe(true)
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ state, ownerSummary })).success).toBe(true)
  })

  it('rejects duplicate knowledge-base IDs in the durable summary', () => {
    const duplicateSummary = { knowledgeBaseIds: ['kb-1', 'kb-1'] }
    expect(
      RestoreJournalV2Schema.safeParse(baseJournal({ state: 'completed', summary: duplicateSummary })).success
    ).toBe(false)
  })

  it('transports current and pre-release owner progress without interpreting business schemas', () => {
    expect(
      RestoreJournalV2Schema.safeParse(
        baseJournal({
          state: 'completed',
          ownerSummary,
          ownerProgress: {
            knowledge: { completedBaseIds: ['unknown-to-data'], abandoned: false },
            futureOwner: { cursor: 4 }
          },
          knowledgeRebuild: { futureLegacyShape: true }
        })
      ).success
    ).toBe(true)
    expect(
      RestoreJournalV2Schema.safeParse(
        baseJournal({ state: 'prepared', ownerSummary, ownerProgress: { invalidJson: undefined } })
      ).success
    ).toBe(false)
    expect(
      RestoreJournalV2Schema.safeParse(
        baseJournal({ state: 'prepared', ownerSummary, knowledgeRebuild: { completedBaseIds: [] } })
      ).success
    ).toBe(false)
  })

  it('accepts owner readiness before commit but rejects the pre-release completion field there', () => {
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ state: 'prepared', ownerSummary })).success).toBe(true)
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ state: 'prepared', summary })).success).toBe(false)
  })

  it('treats owner readiness as opaque JSON rather than interpreting business keys', () => {
    expect(
      RestoreJournalV2Schema.safeParse(
        baseJournal({ state: 'prepared', ownerSummary: { futureOwner: { version: 1, pending: true } } })
      ).success
    ).toBe(true)
    expect(
      RestoreJournalV2Schema.safeParse(baseJournal({ state: 'prepared', ownerSummary: { invalidJson: undefined } }))
        .success
    ).toBe(false)
  })

  it('allows an optional terminal reason on failed/expired', () => {
    expect(
      RestoreJournalV2Schema.safeParse(baseJournal({ state: 'failed', reason: 'integrity check failed' })).success
    ).toBe(true)
    expect(
      RestoreJournalV2Schema.safeParse(baseJournal({ state: 'expired', reason: 'unarmed on unrelated restart' }))
        .success
    ).toBe(true)
    // reason is not a field on prepared (strict)
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ state: 'prepared', reason: 'x' })).success).toBe(false)
  })
})

describe('PROMOTION_STEP_ORDER_V2 — checkpoint-first fail-fast order', () => {
  it('checkpoints the live DB before any resource install, and both before the DB commit', () => {
    const idx = (s: string) => PROMOTION_STEP_ORDER_V2.indexOf(s as (typeof PROMOTION_STEP_ORDER_V2)[number])
    expect(idx('live-checkpointed')).toBeGreaterThanOrEqual(0)
    expect(idx('live-checkpointed')).toBeLessThan(idx('resources-installed'))
    expect(idx('resources-installed')).toBeLessThan(idx(DB_COMMIT_STEP))
    // gate-passed is first (no effects); integrity-ok is last.
    expect(idx('gate-passed')).toBe(0)
    expect(idx('integrity-ok')).toBe(PROMOTION_STEP_ORDER_V2.length - 1)
  })
})

describe('RestoreJournalV2Schema — path distinctness (structural)', () => {
  it('rejects a resource-install entry whose staging and live alias', () => {
    const bad = { ...fullInstall(), live: fullInstall().staging }
    expect(RestoreJournalV2Schema.safeParse(fullJournal({ resourceInstalls: [bad] })).success).toBe(false)
  })

  it('rejects a resource-install entry whose live and aside collide case-insensitively', () => {
    const bad = { resourceType: 'file' as const, staging: 'stage/x', live: 'Data/Foo', aside: 'data/foo' }
    expect(RestoreJournalV2Schema.safeParse(fullJournal({ resourceInstalls: [bad] })).success).toBe(false)
  })

  it('accepts a resource-install entry with three distinct paths', () => {
    expect(RestoreJournalV2Schema.safeParse(fullJournal()).success).toBe(true)
  })

  it('rejects a db payload whose promote and aside alias', () => {
    const j = baseJournal({
      db: { promote: 'restore-staging/work.sqlite', aside: 'restore-staging/work.sqlite', chain }
    })
    expect(RestoreJournalV2Schema.safeParse(j).success).toBe(false)
  })
})

describe('RestoreJournalV2Schema — frozen restore-install cap', () => {
  it('rejects resourceInstalls beyond MAX_RESOURCE_INSTALL_ENTRIES', () => {
    const overCap = Array.from({ length: MAX_RESOURCE_INSTALL_ENTRIES + 1 }, () => fullInstall())
    expect(RestoreJournalV2Schema.safeParse(fullJournal({ resourceInstalls: overCap })).success).toBe(false)
  })

  it('rejects a completed summary with more knowledgeBaseIds than the cap', () => {
    const overCap = Array.from({ length: MAX_RESOURCE_INSTALL_ENTRIES + 1 }, (_, i) => `kb-${i}`)
    const j = baseJournal({ state: 'completed', summary: { knowledgeBaseIds: overCap } })
    expect(RestoreJournalV2Schema.safeParse(j).success).toBe(false)
  })

  it('rejects more degradation lines than the cap, which is why the producer compacts them', () => {
    const overCap = Array.from({ length: MAX_JOURNAL_DEGRADATIONS + 1 }, (_, i) => ({
      kind: `restore-db:t${i}`,
      reason: 'path-unportable (1 row)'
    }))
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ degradations: overCap })).success).toBe(false)
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ degradations: overCap.slice(0, -1) })).success).toBe(true)
  })
})

describe('RestoreJournalV2Schema — degradation report', () => {
  it('accepts a journal with no degradations at all', () => {
    expect(RestoreJournalV2Schema.safeParse(baseJournal()).success).toBe(true)
  })

  it('accepts a reason string this version has never heard of', () => {
    // The journal is read by a LATER app version. Pinning the report to today's
    // reason list would let a new reason quarantine a perfectly good restore.
    const j = baseJournal({ degradations: [{ kind: 'restore-db:future', reason: 'not-yet-invented (7 rows)' }] })
    expect(RestoreJournalV2Schema.safeParse(j).success).toBe(true)
  })

  it('accepts an older single path and a compact report made from the same fields', () => {
    expect(
      RestoreJournalV2Schema.safeParse(
        baseJournal({
          degradations: [
            { kind: 'resource:file-blob', reason: 'absent-at-snapshot', livePath: 'Data/Files/old.pdf' },
            { kind: 'report:resource-changed', reason: 'count:500' },
            { kind: 'report-sample:resource-changed', reason: 'sample', livePath: 'Data/Notes/a' },
            { kind: 'report-sample:resource-changed', reason: 'sample', livePath: 'Data/Notes/b' },
            { kind: 'report-sample:resource-changed', reason: 'sample', livePath: 'Data/Notes/c' }
          ]
        })
      ).success
    ).toBe(true)
  })

  it('rejects an absolute report sample path', () => {
    expect(
      RestoreJournalV2Schema.safeParse(
        baseJournal({
          degradations: [
            { kind: 'report:resource-changed', reason: 'count:1' },
            { kind: 'report-sample:resource-changed', reason: 'sample', livePath: '/private/note' }
          ]
        })
      ).success
    ).toBe(false)
  })

  it('rejects a degradation line carrying unknown fields (strict)', () => {
    const j = baseJournal({
      degradations: [{ kind: 'restore-db:note', reason: 'path-unportable (1 row)', rowId: 'n' }]
    })
    expect(RestoreJournalV2Schema.safeParse(j).success).toBe(false)
  })
})

describe('RestoreJournalV2Schema — preset payload shape', () => {
  it('accepts a journal with resource installs', () => {
    const j = { ...baseJournal(), resourceInstalls: [fullInstall()] }
    expect(RestoreJournalV2Schema.safeParse(j).success).toBe(true)
  })

  it('accepts a journal with an empty install list', () => {
    expect(RestoreJournalV2Schema.safeParse(baseJournal()).success).toBe(true)
  })

  // Full is the only preset that exists; a journal naming another one is a
  // journal this build cannot act on.
  it("rejects a journal declaring preset 'lite'", () => {
    expect(RestoreJournalV2Schema.safeParse(baseJournal({ preset: 'lite' })).success).toBe(false)
  })
})

describe('parseRestoreJournalV2', () => {
  it('returns ok/invalid discriminated results', () => {
    expect(parseRestoreJournalV2(baseJournal()).kind).toBe('ok')
    const invalid = parseRestoreJournalV2({ version: 2 })
    expect(invalid.kind).toBe('invalid')
  })
})

describe('leftover v1 journal quarantine', () => {
  it('rejects a journal written by the v1 format so the gate quarantines it', () => {
    // v1's promotion is gone, but its sidecar may still be on disk from an
    // upgrade. Reinterpreting it would promote a fingerprinted staging tree
    // this build cannot honour, so it must fail to parse (§5.2).
    const v1 = {
      version: 1,
      restoreId: 'restore-1',
      createdAt: '2026-07-27T00:00:00.000Z',
      db: { promote: 'work.sqlite', aside: 'db.sqlite.aside', fingerprint: 'abc', chain },
      fileResources: [],
      state: 'staged'
    }

    expect(RestoreJournalV2Schema.safeParse(v1).success).toBe(false)
  })
})
