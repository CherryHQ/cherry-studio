import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import {
  CHROMIUM_RUNTIME_DIR_NAMES,
  entryNeedsChromiumStorageQuiesce,
  quarantinedChromiumLiveMayBeReinstalled
} from '@data/db/restore/chromiumStorageQuiesce'

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

describe('quarantinedChromiumLiveMayBeReinstalled', () => {
  it('treats an empty leveldb tree as a cleared shell when the quarantine still has data', () => {
    const root = mkdtempSync(join(tmpdir(), 'chromium-quiesce-'))
    const live = join(root, 'live')
    const quarantined = join(root, 'quarantined')
    const liveLeveldb = join(live, 'leveldb')
    const quarantinedLeveldb = join(quarantined, 'leveldb')
    mkdirSync(liveLeveldb, { recursive: true })
    writeFileSync(join(liveLeveldb, 'LOCK'), '')
    mkdirSync(quarantinedLeveldb, { recursive: true })
    writeFileSync(join(quarantinedLeveldb, '000003.ldb'), 'data')

    expect(quarantinedChromiumLiveMayBeReinstalled(live, quarantined, 'Local Storage')).toBe(true)

    rmSync(root, { recursive: true, force: true })
  })

  it('does not clobber a live tree that still has substantive storage content', () => {
    const root = mkdtempSync(join(tmpdir(), 'chromium-quiesce-'))
    const live = join(root, 'live')
    const quarantined = join(root, 'quarantined')
    mkdirSync(live, { recursive: true })
    writeFileSync(join(live, 'leveldb-live'), 'LIVE')
    mkdirSync(quarantined, { recursive: true })
    writeFileSync(join(quarantined, 'leveldb-live'), 'QUARANTINED')

    expect(quarantinedChromiumLiveMayBeReinstalled(live, quarantined, 'Local Storage')).toBe(false)

    rmSync(root, { recursive: true, force: true })
  })
})
