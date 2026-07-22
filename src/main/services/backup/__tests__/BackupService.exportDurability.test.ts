// review-M4 / review-M5 / A8 ⑤ — export temp residue blanket GC + preflight WAL budget.
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { liveDbBytesForPreflight, removeExportTempResidue } from '../BackupService'
import { clearExportLiveMarker, isExportTempOwned, writeExportLiveMarker } from '../exportTempResidue'

describe('removeExportTempResidue (A8 ⑤ blanket)', () => {
  it('blanket-removes the dedicated temp root including unrecognized names', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'cs-export-temp-'))
    try {
      await writeFile(join(tempRoot, 'rid-crash.sqlite'), Buffer.from('UNREDACTED-API-KEY-COPY'))
      await writeFile(join(tempRoot, 'rid-crash.sqlite-wal'), Buffer.from('wal'))
      await writeFile(join(tempRoot, 'rid-crash.sqlite-shm'), Buffer.from('shm'))
      const stage = join(tempRoot, 'rid-crash-stage')
      await mkdir(stage)
      await writeFile(join(stage, 'files-placeholder'), Buffer.from('blob'))
      // Unrecognized future shape — must also be cleared (dedicated namespace).
      await writeFile(join(tempRoot, 'notes.txt'), Buffer.from('stray'))
      await writeFile(join(tempRoot, 'orphan.bin'), Buffer.from('stray-too'))
      // Stale marker from a dead pid must not block GC.
      writeExportLiveMarker(tempRoot, 'rid-crash', 999_999_999)

      expect(removeExportTempResidue(tempRoot)).toBe(1)
      expect(existsSync(tempRoot)).toBe(false)
      // Second call: missing root → sentinel 0.
      expect(removeExportTempResidue(tempRoot)).toBe(0)
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('skips the whole root when any live export marker pid is alive', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'cs-export-temp-'))
    try {
      await writeFile(join(tempRoot, 'rid-live.sqlite'), Buffer.from('ACTIVE-EXPORT'))
      await mkdir(join(tempRoot, 'rid-live-stage'))
      await writeFile(join(tempRoot, 'stray-future.dat'), Buffer.from('also-protected'))
      writeExportLiveMarker(tempRoot, 'rid-live', process.pid)

      expect(isExportTempOwned(tempRoot, 'rid-live')).toBe(true)
      expect(removeExportTempResidue(tempRoot)).toBe(0)
      expect(existsSync(tempRoot)).toBe(true)
      expect(existsSync(join(tempRoot, 'rid-live.sqlite'))).toBe(true)
      expect(existsSync(join(tempRoot, 'rid-live-stage'))).toBe(true)
      expect(existsSync(join(tempRoot, 'stray-future.dat'))).toBe(true)

      clearExportLiveMarker(tempRoot, 'rid-live')
      expect(removeExportTempResidue(tempRoot)).toBe(1)
      expect(existsSync(tempRoot)).toBe(false)
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('is a no-op when temp root is missing or empty', async () => {
    expect(removeExportTempResidue(join(tmpdir(), 'cs-export-temp-missing-xyz'))).toBe(0)
    const empty = await mkdtemp(join(tmpdir(), 'cs-export-temp-empty-'))
    try {
      // Empty dedicated root is still removed (blanket); return 1.
      expect(removeExportTempResidue(empty)).toBe(1)
      expect(existsSync(empty)).toBe(false)
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })
})

describe('liveDbBytesForPreflight (review-M5)', () => {
  it('includes -wal size in the budget (main + wal)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-preflight-wal-'))
    try {
      const db = join(dir, 'cherry.db')
      await writeFile(db, Buffer.alloc(1000, 1))
      await writeFile(`${db}-wal`, Buffer.alloc(4000, 2))
      expect(await liveDbBytesForPreflight(db)).toBe(5000)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('treats missing -wal as 0 (checkpointed / non-WAL)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-preflight-nowal-'))
    try {
      const db = join(dir, 'cherry.db')
      await writeFile(db, Buffer.alloc(250, 1))
      expect(await liveDbBytesForPreflight(db)).toBe(250)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
