import { describe, expect, it } from 'vitest'

import { CHROMIUM_RUNTIME_DIR_NAMES, journalNeedsChromiumStorageQuiesce } from '@data/db/restore/chromiumStorageQuiesce'
import type { RestoreJournal } from '@data/db/restore/restoreJournal'

describe('journalNeedsChromiumStorageQuiesce', () => {
  const baseJournal = {
    version: 1 as const,
    restoreId: 'restore-test',
    createdAt: '2026-09-22T00:00:00.000Z',
    db: {
      promote: 'restore-staging/restore-test/work.sqlite',
      aside: 'Data/cherrystudio.sqlite.pre-restore-restore-test',
      fingerprint: 'abc',
      chain: [{ folderMillis: 1, hash: 'x' }]
    },
    fileResources: [] as RestoreJournal['fileResources']
  }

  it('returns false on non-Windows platforms', () => {
    if (process.platform === 'win32') {
      return
    }

    expect(
      journalNeedsChromiumStorageQuiesce({
        ...baseJournal,
        state: 'staged',
        fileResources: [{ kind: 'overwrite', stagingPath: 'a', livePath: 'Local Storage', asidePath: 'b' }]
      })
    ).toBe(false)
  })

  it('returns false when no Chromium runtime directories are overwritten', () => {
    if (process.platform !== 'win32') {
      return
    }

    expect(
      journalNeedsChromiumStorageQuiesce({
        ...baseJournal,
        state: 'staged',
        fileResources: [
          { kind: 'overwrite', stagingPath: 'a', livePath: 'cache.json', asidePath: 'b' },
          { kind: 'dir-add', stagingPath: 'c', livePath: 'Data/Files/x' }
        ]
      })
    ).toBe(false)
  })

  it('returns true when Local Storage or IndexedDB is overwritten on Windows', () => {
    if (process.platform !== 'win32') {
      return
    }

    for (const livePath of CHROMIUM_RUNTIME_DIR_NAMES) {
      expect(
        journalNeedsChromiumStorageQuiesce({
          ...baseJournal,
          state: 'staged',
          fileResources: [{ kind: 'overwrite', stagingPath: 'a', livePath, asidePath: 'b' }]
        })
      ).toBe(true)
    }
  })
})
