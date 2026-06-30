// Lockstep test for the BackupDomain union ↔ BACKUP_DOMAINS array mirror.
//
// BackupDomain (the union) is hand-authored in domains.ts as the spec source of
// truth; BACKUP_DOMAINS (the array) mirrors it for runtime iteration (finalize #1,
// topoSort, ReadonlyBackupRegistry.domains). The array's `as const satisfies
// readonly BackupDomain[]` only guarantees array ⊆ union — every listed element is
// a valid member. This test pins the REVERSE direction (union ⊆ array) so adding a
// domain to the union without the array, or duplicating an entry, fails loudly.
import { describe, expect, it } from 'vitest'

import { BACKUP_DOMAINS, type BackupDomain } from './domains'

// Compile-time exhaustiveness guard: resolves to `true` only when every BackupDomain
// union member appears among BACKUP_DOMAINS' literal elements (the array is `as
// const`). A union member omitted from the array makes this `never`, breaking the
// build — the one drift the array's element type cannot catch. Referenced in the
// test below so it is never tree-shaken as unused.
const DOMAINS_EXHAUSTIVE: BackupDomain extends (typeof BACKUP_DOMAINS)[number] ? true : never = true

describe('BACKUP_DOMAINS', () => {
  it('has exactly 14 domains (registry.length === 14, finalize #1)', () => {
    expect(BACKUP_DOMAINS).toHaveLength(14)
  })

  it('has no duplicate domains', () => {
    expect(new Set(BACKUP_DOMAINS).size).toBe(BACKUP_DOMAINS.length)
  })

  it('exhausts the BackupDomain union (compile-time guard passes)', () => {
    // Fails to COMPILE if a BackupDomain member is missing from the array; the
    // runtime assert guards against the guard itself being silently dropped.
    expect(DOMAINS_EXHAUSTIVE).toBe(true)
  })
})
