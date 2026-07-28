import { RELATIVE_SUBPATH_LIMITS } from '@main/utils/relativePath'
import { describe, expect, it } from 'vitest'

import { BACKUP_CEILINGS } from '../ceilings'

describe('BACKUP_CEILINGS', () => {
  it('shares generic portable path limits and leaves room for both Lite entries', () => {
    expect(BACKUP_CEILINGS.maxPathDepth).toBe(RELATIVE_SUBPATH_LIMITS.maxDepth)
    expect(BACKUP_CEILINGS.maxPathLength).toBe(RELATIVE_SUBPATH_LIMITS.maxLength)
    expect(BACKUP_CEILINGS.maxArchiveEntries).toBeGreaterThanOrEqual(2)
  })
})
