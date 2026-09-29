import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CHROMIUM_RUNTIME_DIR_NAMES,
  entryNeedsChromiumStorageQuiesce,
  quiesceChromiumStorageForRestore
} from '@data/db/restore/chromiumStorageQuiesce'

const electronMocks = vi.hoisted(() => ({
  whenReady: vi.fn(() => Promise.resolve()),
  clearData: vi.fn(() => Promise.resolve())
}))

vi.mock('electron', () => ({
  app: { whenReady: electronMocks.whenReady },
  session: { defaultSession: { clearData: electronMocks.clearData } }
}))

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

describe('quiesceChromiumStorageForRestore', () => {
  const tempRoots: string[] = []

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true })
    }
    vi.clearAllMocks()
  })

  it('does not call clearData when the live directory is absent', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-quiesce-'))
    tempRoots.push(userData)

    await quiesceChromiumStorageForRestore('Local Storage', userData)

    expect(electronMocks.clearData).not.toHaveBeenCalled()
  })

  it('calls clearData only for the matching storage type when live exists', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-quiesce-'))
    tempRoots.push(userData)
    fs.mkdirSync(path.join(userData, 'IndexedDB'), { recursive: true })

    await quiesceChromiumStorageForRestore('IndexedDB', userData)

    expect(electronMocks.clearData).toHaveBeenCalledWith({ dataTypes: ['indexedDB'] })
  })
})
