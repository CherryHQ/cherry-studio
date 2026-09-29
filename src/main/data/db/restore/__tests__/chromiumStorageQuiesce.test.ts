import { describe, expect, it } from 'vitest'

import { CHROMIUM_RUNTIME_DIR_NAMES, entryNeedsChromiumStorageQuiesce } from '@data/db/restore/chromiumStorageQuiesce'

describe('entryNeedsChromiumStorageQuiesce', () => {
  it('returns false on non-Windows platforms', () => {
    if (process.platform === 'win32') {
      return
    }

    expect(
      entryNeedsChromiumStorageQuiesce({
        kind: 'overwrite',
        stagingPath: 'a',
        livePath: 'Local Storage',
        asidePath: 'b'
      })
    ).toBe(false)
  })

  it('returns true only for Chromium runtime overwrites on Windows', () => {
    if (process.platform !== 'win32') {
      return
    }

    for (const livePath of CHROMIUM_RUNTIME_DIR_NAMES) {
      expect(
        entryNeedsChromiumStorageQuiesce({
          kind: 'overwrite',
          stagingPath: 'a',
          livePath,
          asidePath: 'b'
        })
      ).toBe(true)
    }
    expect(
      entryNeedsChromiumStorageQuiesce({
        kind: 'overwrite',
        stagingPath: 'a',
        livePath: 'cache.json',
        asidePath: 'b'
      })
    ).toBe(false)
    expect(
      entryNeedsChromiumStorageQuiesce({
        kind: 'blob-add',
        stagingPath: 'a',
        livePath: 'Local Storage'
      })
    ).toBe(false)
  })
})
