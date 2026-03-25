import { describe, expect, it } from 'vitest'

import { getPromptVersionRollbackMarker } from '../promptVersion'

describe('getPromptVersionRollbackMarker', () => {
  it('returns null when it is not a rollback', () => {
    expect(getPromptVersionRollbackMarker(null, (rollbackFrom) => `restored from v${rollbackFrom}`)).toBeNull()
  })

  it('returns rollback metadata when present', () => {
    expect(getPromptVersionRollbackMarker(1, (rollbackFrom) => `restored from v${rollbackFrom}`)).toBe(
      'restored from v1'
    )
  })
})
