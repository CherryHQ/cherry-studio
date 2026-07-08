// coverage.test.ts — registry coverage gate (contributor-testing.md "registry
// coverage test"). Validates that every Drizzle user-data table is owned by
// exactly one contributor or explicitly excluded, mirroring finalize #2/#3/#4
// against the LIVE schema universe (DB_TABLES) — finalize does not connect to the
// DB, so this test is the actual-schema coverage backstop.
//
// Two tiers:
//  - structural: always enforced (owned∈DB_TABLES, no multi-owner, excluded-not-
//    owned, known domains). Green on every branch.
//  - exhaustiveness: a STRICT drift gate — every BackupDomain is implemented,
//    every user table is owned-or-excluded, every FTS content table is covered.
//    All 14 domains have landed, so the gate is tight: any new Drizzle table with
//    no owner, or a regressed contributor, fails here. (Previously this was a
//    subset-of-Wave2 allowlist while Wave 2 was landing; tightened to strict once
//    all 14 landed — do NOT re-add a Wave2 allowlist, add the owner instead.)
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

describe('coverage — exhaustiveness (strict: all 14 domains landed)', () => {
  // Tightened from a subset-of-Wave2 gate once all 14 contributors landed. Any
  // unowned table / missing domain / uncovered FTS content now fails outright —
  // do NOT re-add an allowlist; add the owner (or exclude the table) instead.

  it('every BackupDomain is implemented exactly once (no missing / duplicate)', () => {
    const counts = new Map<BackupDomain, number>()
    for (const c of CONTRIBUTORS) counts.set(c.domain, (counts.get(c.domain) ?? 0) + 1)
    const missing = BACKUP_DOMAINS.filter((d) => !counts.has(d))
    const duplicated = [...counts.entries()].filter(([, n]) => n > 1).map(([d]) => d)
    expect({ missing, duplicated }, `missing: ${missing.join(', ')} | duplicated: ${duplicated.join(', ')}`).toEqual({
      missing: [],
      duplicated: []
    })
  })

  it('every user table is owned or excluded (no unowned drift)', () => {
    const owned = ownedTables()
    const unowned = DB_TABLES.filter((table) => !owned.has(table) && !EXCLUDED.has(table))
    expect(unowned, `unowned (add an owner or exclude): ${unowned.join(', ')}`).toEqual([])
  })

  it('every FTS content table is owned or excluded', () => {
    const owned = ownedTables()
    const uncovered = Object.entries(DB_FTS_VIRTUAL_TABLES)
      .filter(([, content]) => !owned.has(content) && !EXCLUDED.has(content))
      .map(([, content]) => content)
    expect(uncovered, `FTS content uncovered: ${uncovered.join(', ')}`).toEqual([])
  })
})
