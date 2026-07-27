import { describe, expect, it } from 'vitest'

import { RestoreJournalSchema as RestoreJournalV1Schema } from '../restoreJournal'
import {
  DB_COMMIT_STEP,
  parseRestoreJournalV2,
  PROMOTION_STEP_ORDER_V2,
  RESTORE_JOURNAL_VERSION,
  RestoreJournalV2Schema
} from '../restoreJournalV2'
import { MAX_RESOURCE_INSTALL_ENTRIES } from '../restoreLimits'

const chain = [{ folderMillis: 1_700_000_000_000, hash: 'h1' }]
const UUID = '11111111-2222-4333-8444-555555555555'
const summary = { knowledgeBaseIds: [] as string[] }

function liteJournal(overrides: Record<string, unknown> = {}) {
  return {
    version: RESTORE_JOURNAL_VERSION,
    restoreId: UUID,
    preset: 'lite' as const,
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
  return { ...liteJournal(), preset: 'full' as const, resourceInstalls: [fullInstall()], ...overrides }
}

describe('RestoreJournalV2Schema — versions & states', () => {
  it('accepts all six lifecycle states', () => {
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ state: 'prepared' })).success).toBe(true)
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ state: 'armed' })).success).toBe(true)
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ state: 'promoting', step: 'db-promoted' })).success).toBe(
      true
    )
    expect(
      RestoreJournalV2Schema.safeParse(liteJournal({ state: 'completed', step: 'integrity-ok', summary })).success
    ).toBe(true)
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ state: 'completed', summary })).success).toBe(true)
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ state: 'failed' })).success).toBe(true)
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ state: 'expired' })).success).toBe(true)
  })

  it('requires a step for promoting and rejects unknown steps/states', () => {
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ state: 'promoting' })).success).toBe(false)
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ state: 'promoting', step: 'not-a-step' })).success).toBe(
      false
    )
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ state: 'staged' })).success).toBe(false)
  })

  it('pins the version literal to 2', () => {
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ version: 1 })).success).toBe(false)
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ version: 3 })).success).toBe(false)
  })

  it('rejects unknown top-level fields (strict)', () => {
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ extra: true })).success).toBe(false)
  })

  it('rejects a fingerprint field on db (v2 dropped it)', () => {
    const j = liteJournal()
    ;(j.db as Record<string, unknown>).fingerprint = 'deadbeef'
    expect(RestoreJournalV2Schema.safeParse(j).success).toBe(false)
  })

  it('requires a complete (non-empty) migration chain', () => {
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ db: { promote: 'a', aside: 'b', chain: [] } })).success).toBe(
      false
    )
  })

  it('rejects absolute / escaping resource-install paths', () => {
    const bad = { ...fullInstall(), live: '/etc/passwd' }
    const j = { ...liteJournal(), preset: 'full' as const, resourceInstalls: [bad] }
    expect(RestoreJournalV2Schema.safeParse(j).success).toBe(false)
  })

  it('requires restoreId to be a UUID', () => {
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ restoreId: 'restore-1' })).success).toBe(false)
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ restoreId: UUID })).success).toBe(true)
  })

  it('requires an ISO-8601 datetime createdAt', () => {
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ createdAt: 'now' })).success).toBe(false)
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ createdAt: '2026-07-27' })).success).toBe(false)
  })
})

describe('RestoreJournalV2Schema — terminal fields', () => {
  it('requires a durable summary on completed', () => {
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ state: 'completed' })).success).toBe(false)
    expect(
      RestoreJournalV2Schema.safeParse(liteJournal({ state: 'completed', summary: { knowledgeBaseIds: ['kb-1'] } }))
        .success
    ).toBe(true)
  })

  it('rejects duplicate knowledge-base IDs in the durable summary', () => {
    const duplicateSummary = { knowledgeBaseIds: ['kb-1', 'kb-1'] }
    expect(
      RestoreJournalV2Schema.safeParse(liteJournal({ state: 'completed', summary: duplicateSummary })).success
    ).toBe(false)
  })

  it('rejects a summary on non-completed states (strict)', () => {
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ state: 'prepared', summary })).success).toBe(false)
  })

  it('allows an optional terminal reason on failed/expired', () => {
    expect(
      RestoreJournalV2Schema.safeParse(liteJournal({ state: 'failed', reason: 'integrity check failed' })).success
    ).toBe(true)
    expect(
      RestoreJournalV2Schema.safeParse(liteJournal({ state: 'expired', reason: 'unarmed on unrelated restart' }))
        .success
    ).toBe(true)
    // reason is not a field on prepared (strict)
    expect(RestoreJournalV2Schema.safeParse(liteJournal({ state: 'prepared', reason: 'x' })).success).toBe(false)
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
    const j = liteJournal({
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
    const j = liteJournal({ state: 'completed', summary: { knowledgeBaseIds: overCap } })
    expect(RestoreJournalV2Schema.safeParse(j).success).toBe(false)
  })
})

describe('RestoreJournalV2Schema — preset payload shape', () => {
  it('rejects a lite journal that declares resource installs', () => {
    const j = liteJournal({ resourceInstalls: [fullInstall()] })
    expect(RestoreJournalV2Schema.safeParse(j).success).toBe(false)
  })

  it('accepts a full journal with resource installs', () => {
    const j = { ...liteJournal(), preset: 'full' as const, resourceInstalls: [fullInstall()] }
    expect(RestoreJournalV2Schema.safeParse(j).success).toBe(true)
  })

  it('accepts a lite journal with an empty install list', () => {
    expect(RestoreJournalV2Schema.safeParse(liteJournal()).success).toBe(true)
  })
})

describe('parseRestoreJournalV2', () => {
  it('returns ok/invalid discriminated results', () => {
    expect(parseRestoreJournalV2(liteJournal()).kind).toBe('ok')
    const invalid = parseRestoreJournalV2({ version: 2 })
    expect(invalid.kind).toBe('invalid')
  })
})

describe('journal downgrade quarantine (v1 <-> v2 mutual rejection)', () => {
  it('a valid v2 journal is rejected by the v1 parser', () => {
    const v2 = liteJournal()
    // Prove it is a genuinely valid v2 journal first, then that v1 rejects it.
    expect(RestoreJournalV2Schema.safeParse(v2).success).toBe(true)
    expect(RestoreJournalV1Schema.safeParse(v2).success).toBe(false)
  })

  it('a valid v1 journal is rejected by the v2 parser', () => {
    const v1 = {
      version: 1,
      restoreId: 'restore-1',
      createdAt: '2026-07-27T00:00:00.000Z',
      db: { promote: 'work.sqlite', aside: 'db.sqlite.aside', fingerprint: 'abc', chain },
      fileResources: [],
      state: 'staged'
    }
    expect(RestoreJournalV1Schema.safeParse(v1).success).toBe(true)
    expect(RestoreJournalV2Schema.safeParse(v1).success).toBe(false)
  })
})
