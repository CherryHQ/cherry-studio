// review-M4 / review-M5 — export temp residue GC + preflight WAL budget.
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { liveDbBytesForPreflight, removeExportTempResidue } from '../BackupService'
import {
  clearExportLiveMarker,
  isExportTempOwned,
  restoreIdFromExportTempEntry,
  writeExportLiveMarker
} from '../exportTempResidue'

describe('removeExportTempResidue (review-M4)', () => {
  it('scans and removes orphaned .sqlite + *-stage (+ wal/shm) residues', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'cs-export-temp-'))
    try {
      // Crashed export layout: `{restoreId}.sqlite` + sidecars + `{restoreId}-stage/`
      await writeFile(join(tempRoot, 'rid-crash.sqlite'), Buffer.from('UNREDACTED-API-KEY-COPY'))
      await writeFile(join(tempRoot, 'rid-crash.sqlite-wal'), Buffer.from('wal'))
      await writeFile(join(tempRoot, 'rid-crash.sqlite-shm'), Buffer.from('shm'))
      const stage = join(tempRoot, 'rid-crash-stage')
      await mkdir(stage)
      await writeFile(join(stage, 'files-placeholder'), Buffer.from('blob'))
      // Stale marker from a dead pid must not block GC.
      writeExportLiveMarker(tempRoot, 'rid-crash', 999_999_999)

      const removed = removeExportTempResidue(tempRoot)
      expect(removed).toBeGreaterThanOrEqual(4)
      expect(existsSync(join(tempRoot, 'rid-crash.sqlite'))).toBe(false)
      expect(existsSync(stage)).toBe(false)
      expect(existsSync(join(tempRoot, 'rid-crash.export-live'))).toBe(false)
      expect(removeExportTempResidue(tempRoot)).toBe(0)
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('does NOT delete unrelated top-level files', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'cs-export-temp-'))
    try {
      await writeFile(join(tempRoot, 'notes.txt'), Buffer.from('keep-me'))
      await writeFile(join(tempRoot, 'orphan.bin'), Buffer.from('keep-me-too'))
      expect(removeExportTempResidue(tempRoot)).toBe(0)
      expect(existsSync(join(tempRoot, 'notes.txt'))).toBe(true)
      expect(existsSync(join(tempRoot, 'orphan.bin'))).toBe(true)
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('skips residue owned by a live export marker (pid stamp)', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'cs-export-temp-'))
    try {
      await writeFile(join(tempRoot, 'rid-live.sqlite'), Buffer.from('ACTIVE-EXPORT'))
      await mkdir(join(tempRoot, 'rid-live-stage'))
      writeExportLiveMarker(tempRoot, 'rid-live', process.pid)

      expect(isExportTempOwned(tempRoot, 'rid-live')).toBe(true)
      expect(removeExportTempResidue(tempRoot)).toBe(0)
      expect(existsSync(join(tempRoot, 'rid-live.sqlite'))).toBe(true)
      expect(existsSync(join(tempRoot, 'rid-live-stage'))).toBe(true)

      clearExportLiveMarker(tempRoot, 'rid-live')
      expect(removeExportTempResidue(tempRoot)).toBeGreaterThanOrEqual(2)
      expect(existsSync(join(tempRoot, 'rid-live.sqlite'))).toBe(false)
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('is a no-op when temp root is missing or empty', async () => {
    expect(removeExportTempResidue(join(tmpdir(), 'cs-export-temp-missing-xyz'))).toBe(0)
    const empty = await mkdtemp(join(tmpdir(), 'cs-export-temp-empty-'))
    try {
      expect(removeExportTempResidue(empty)).toBe(0)
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })

  it('maps only known residue entry names to restoreId', () => {
    expect(restoreIdFromExportTempEntry('abc.sqlite')).toBe('abc')
    expect(restoreIdFromExportTempEntry('abc.sqlite-wal')).toBe('abc')
    expect(restoreIdFromExportTempEntry('abc.sqlite-shm')).toBe('abc')
    expect(restoreIdFromExportTempEntry('abc-stage')).toBe('abc')
    expect(restoreIdFromExportTempEntry('abc.export-live')).toBe('abc')
    expect(restoreIdFromExportTempEntry('notes.txt')).toBeNull()
    expect(restoreIdFromExportTempEntry('random')).toBeNull()
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
