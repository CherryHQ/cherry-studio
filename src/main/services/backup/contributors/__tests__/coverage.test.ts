// coverage.test.ts — registry coverage gate (contributor-testing.md "registry
// coverage test"). Validates that every Drizzle user-data table is owned by
// exactly one contributor or explicitly excluded, mirroring finalize #2/#3/#4
// against the LIVE schema universe (DB_TABLES) — finalize does not connect to the
// DB, so this test is the actual-schema coverage backstop.
//
// Two tiers:
//  - structural: always enforced (owned∈DB_TABLES, no multi-owner, excluded-not-
//    owned, known domains). Green on every branch.
//  - exhaustiveness: a DRIFT gate, not a red progress bar. It asserts the current
//    coverage gap is a SUBSET of the acknowledged Wave-2 set (WAVE2_* constants
//    below). Green now; it FAILS only on unintended drift — a table/domain that is
//    unowned AND not acknowledged here (e.g. a new Drizzle table with no owner, or
//    a Wave-1 contributor that regressed). As Wave 2 contributors land, the gap
//    shrinks and the subset still holds, so this needs no per-domain edits; when
//    all 14 land, tighten these to strict `=== []`.
//
// This test does NOT connect to SQLite (pure in-memory assertions over the codegen
// product + the contributor declarations), per contributor-testing.md
// "纯声明测试不连 DB".
import { DB_FTS_VIRTUAL_TABLES, DB_TABLES } from '@main/data/db/backup/dbSchemaRefs'
import { BACKUP_DOMAINS, type BackupDomain } from '@main/data/db/backup/domains'
import { ALWAYS_STRIP_TABLES, INFRASTRUCTURE_TABLES } from '@main/data/db/backup/exclusions'
import { describe, expect, it } from 'vitest'

import { CONTRIBUTORS } from '../index'

/** Tables never owned by a contributor (stripped or infrastructure). */
const EXCLUDED = new Set<string>([...INFRASTRUCTURE_TABLES, ...ALWAYS_STRIP_TABLES])
/** All tables currently owned across the wired contributors. */
const ownedTables = (): Set<string> => new Set(CONTRIBUTORS.flatMap((c) => c.schema.tables as readonly string[]))

/**
 * Acknowledged Wave-2 gap — domains/tables/FTS-content whose contributors are
 * pending their blocking schema PRs (see ~/Downloads/backup-schema-status-2026-06-30.md).
 * The exhaustiveness drift gate asserts the actual gap is a subset of this set.
 */
const WAVE2_DOMAINS = new Set<BackupDomain>(['PROVIDERS', 'AGENTS', 'MINIAPPS', 'TOPICS', 'PAINTINGS'])
const WAVE2_TABLES = new Set<string>([
  'agent',
  'agent_channel',
  'agent_channel_task',
  'agent_mcp_server',
  'agent_session',
  'agent_session_message',
  'agent_skill',
  'agent_workspace',
  'chat_message_file_ref',
  'job_schedule',
  'message',
  'mini_app',
  'painting',
  'painting_file_ref',
  'topic',
  'user_model',
  'user_provider'
])
/** FTS content tables not yet owned (message→TOPICS, agent_session_message→AGENTS). */
const WAVE2_FTS_CONTENT = new Set<string>(['message', 'agent_session_message'])

describe('coverage — structural (always enforced)', () => {
  it('every owned table is a real Drizzle user table (finalize #2 mirror)', () => {
    const known = new Set<string>(DB_TABLES)
    for (const c of CONTRIBUTORS) {
      for (const table of c.schema.tables) {
        expect(known.has(table), `${c.domain} owns unknown table ${table}`).toBe(true)
      }
    }
  })

  it('no table is owned by two contributors (finalize #3 mirror)', () => {
    const owners = new Map<string, string[]>()
    for (const c of CONTRIBUTORS) {
      for (const table of c.schema.tables) {
        owners.set(table, [...(owners.get(table) ?? []), c.domain])
      }
    }
    for (const [table, domains] of owners) {
      expect(domains, `${table} multi-owned by ${domains.join(', ')}`).toHaveLength(1)
    }
  })

  it('no contributor owns an ALWAYS_STRIP / INFRASTRUCTURE table (finalize #4 mirror)', () => {
    for (const c of CONTRIBUTORS) {
      for (const table of c.schema.tables) {
        expect(EXCLUDED.has(table), `${c.domain} owns excluded table ${table}`).toBe(false)
      }
    }
  })

  it('every contributor domain is a known BackupDomain', () => {
    const known = new Set<BackupDomain>(BACKUP_DOMAINS)
    for (const c of CONTRIBUTORS) {
      expect(known.has(c.domain), `unknown domain ${c.domain}`).toBe(true)
    }
  })
})

describe('coverage — exhaustiveness (drift gate; gap ⊆ acknowledged Wave-2 set)', () => {
  // GREEN now: the Wave-1 gap is entirely inside WAVE2_*. FAILS only on unintended
  // drift (an unowned/missing table or domain not acknowledged as Wave 2, or a
  // duplicated domain). Tighten to strict `=== []` once all 14 contributors land.

  it('every BackupDomain is implemented, or acknowledged as Wave 2 (no duplicates)', () => {
    const counts = new Map<BackupDomain, number>()
    for (const c of CONTRIBUTORS) counts.set(c.domain, (counts.get(c.domain) ?? 0) + 1)
    const missing = BACKUP_DOMAINS.filter((d) => !counts.has(d))
    const duplicated = [...counts.entries()].filter(([, n]) => n > 1).map(([d]) => d)
    const unexpectedMissing = missing.filter((d) => !WAVE2_DOMAINS.has(d))
    expect(
      { unexpectedMissing, duplicated },
      `unexpected missing: ${unexpectedMissing.join(', ')} | duplicated: ${duplicated.join(', ')}`
    ).toEqual({ unexpectedMissing: [], duplicated: [] })
  })

  it('every unowned table is excluded or acknowledged as Wave 2 (drift guard)', () => {
    const owned = ownedTables()
    const unowned = DB_TABLES.filter((table) => !owned.has(table) && !EXCLUDED.has(table))
    const unexpected = unowned.filter((table) => !WAVE2_TABLES.has(table))
    expect(unexpected, `unexpectedly unowned (not Wave-2-acknowledged): ${unexpected.join(', ')}`).toEqual([])
  })

  it('FTS content tables are owned/excluded or acknowledged as Wave 2', () => {
    const owned = ownedTables()
    const uncovered = Object.entries(DB_FTS_VIRTUAL_TABLES)
      .filter(([, content]) => !owned.has(content) && !EXCLUDED.has(content))
      .map(([, content]) => content)
    const unexpected = uncovered.filter((content) => !WAVE2_FTS_CONTENT.has(content))
    expect(unexpected, `FTS content unexpectedly uncovered: ${unexpected.join(', ')}`).toEqual([])
  })
})
