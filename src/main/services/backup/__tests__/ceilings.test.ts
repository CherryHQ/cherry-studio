import { MAX_RESOURCE_INSTALL_ENTRIES } from '@data/db/restore/restoreLimits'
import { RELATIVE_SUBPATH_LIMITS } from '@main/utils/relativePath'
import { describe, expect, it } from 'vitest'

import { BACKUP_CEILINGS } from '../ceilings'

describe('BACKUP_CEILINGS', () => {
  it('is frozen (single source of truth cannot be mutated at runtime)', () => {
    expect(Object.isFrozen(BACKUP_CEILINGS)).toBe(true)
  })

  it('holds only positive integer bounds', () => {
    for (const value of Object.values(BACKUP_CEILINGS)) {
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThan(0)
    }
  })

  it('is internally consistent', () => {
    expect(BACKUP_CEILINGS.maxEntryUncompressedBytes).toBeLessThanOrEqual(BACKUP_CEILINGS.maxTotalUncompressedBytes)
    expect(BACKUP_CEILINGS.maxResourceInstallEntries).toBeLessThanOrEqual(BACKUP_CEILINGS.maxArchiveEntries)
  })

  it('mirrors the generic relative-subpath limits (no drift between path bounds)', () => {
    expect(BACKUP_CEILINGS.maxPathDepth).toBe(RELATIVE_SUBPATH_LIMITS.maxDepth)
    expect(BACKUP_CEILINGS.maxPathLength).toBe(RELATIVE_SUBPATH_LIMITS.maxLength)
  })

  it('consumes the data-layer restore-install cap (single source, no drift)', () => {
    expect(BACKUP_CEILINGS.maxResourceInstallEntries).toBe(MAX_RESOURCE_INSTALL_ENTRIES)
  })

  it('freezes the pre-parse manifest byte cap that bounds unbounded manifest arrays', () => {
    expect(BACKUP_CEILINGS.maxManifestBytes).toBe(32 * 1024 ** 2)
  })
})
