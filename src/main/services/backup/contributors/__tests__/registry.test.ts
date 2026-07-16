// Registry integration test — loads the REAL CONTRIBUTORS barrel (all 14
// domains) and runs the full finalize invariant suite against it.
//
// finalize.test.ts exercises the invariants with a synthetic 14-domain fixture,
// which proves the invariant LOGIC but not that the real declarations satisfy
// them. This test is the guard against drift between the barrel and the
// invariants (e.g. a new domain added to the barrel but missing a required
// aggregate / reference declaration would pass its own unit test yet trip an
// invariant here). It mirrors what BackupService.onInit() will do once the
// B-track wires `new ContributorManager(CONTRIBUTORS)`.
import { BACKUP_DOMAINS } from '@main/data/db/backup/domains'
import { describe, expect, it } from 'vitest'

import { ContributorManager } from '../ContributorManager'
import { contributorManager, CONTRIBUTORS } from '../index'

describe('CONTRIBUTORS registry — real declarations', () => {
  it('covers every BackupDomain exactly (no missing / extra / duplicate)', () => {
    const domains = CONTRIBUTORS.map((c) => c.domain)
    expect(domains).toHaveLength(BACKUP_DOMAINS.length)
    // Order-independent compare (the barrel declaration order differs from
    // BACKUP_DOMAINS' tuple order and Set equality is iteration-order sensitive).
    expect([...domains].sort()).toEqual([...BACKUP_DOMAINS].sort())
  })

  it('passes the full finalize invariant suite against the real 14 declarations', () => {
    // getRegistry() runs finalize (all invariants) lazily and throws
    // ContributorFinalizeError on any violation. No throw = the real barrel
    // is self-consistent.
    const registry = new ContributorManager(CONTRIBUTORS).getRegistry()
    expect(registry).toBeDefined()
  })

  it('production singleton `contributorManager` is wired with the real barrel', () => {
    // Guards the wiring (P0 from review): a bare `new ContributorManager()` would
    // fail #1 (empty); a synthetic fixture would pass finalize but not expose 14
    // real domains. Assert the singleton finalizes AND carries all 14 domains.
    const registry = contributorManager.getRegistry()
    expect(registry.domains).toHaveLength(BACKUP_DOMAINS.length)
  })

  it('public PK/FK/domain getters return runtime-immutable facts (F6)', () => {
    // F6: finalize freezes the contributor graph + registry Maps, but the public
    // getters returning codegen facts directly (getPrimaryKey/getForeignKeys/
    // domains → DB_PRIMARY_KEYS/DB_FOREIGN_KEYS/BACKUP_DOMAINS) must also hand back
    // frozen objects — `as const` is compile-time only. A mutation here would
    // corrupt every later registry consumer.
    const registry = contributorManager.getRegistry()

    // domains — BACKUP_DOMAINS array is frozen
    expect(Object.isFrozen(registry.domains)).toBe(true)
    expect(() => (registry.domains as unknown as unknown[]).push('X')).toThrow(TypeError)

    // getPrimaryKey — a real table's PK fact + its columns are frozen
    const pk = registry.getPrimaryKey('topic')
    expect(Object.isFrozen(pk)).toBe(true)
    expect(Object.isFrozen(pk.columns)).toBe(true)
    expect(() => (pk.columns as unknown as unknown[]).push('x')).toThrow(TypeError)

    // getForeignKeys — a real table's FK array + nested fact columns are frozen
    const fks = registry.getForeignKeys('message')
    expect(Object.isFrozen(fks)).toBe(true)
    if (fks.length > 0) {
      const fk = fks[0]
      expect(Object.isFrozen(fk)).toBe(true)
      expect(Object.isFrozen(fk.columns)).toBe(true)
      expect(() => (fk.columns as unknown as unknown[]).push('x')).toThrow(TypeError)
    }
  })
})
