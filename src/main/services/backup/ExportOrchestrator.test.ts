// Unit tests for ExportOrchestrator — e2e .cbu production (full-preset, DB-only slice).
import Database from 'better-sqlite3'
import StreamZip from 'node-stream-zip'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ReadonlyBackupRegistry } from '@main/data/db/backup/contributor-types'
import { BACKUP_DOMAINS } from '@main/data/db/backup/domains'
import { describe, expect, it } from 'vitest'

import { StubBackupCopier } from './BackupDbCopier'
import { ExportOrchestrator } from './ExportOrchestrator'

/**
 * Minimal registry stub — the orchestrator's first slice only calls `topoSort`.
 * Real registry integration (real topoSort by reference deps) is covered by the
 * finalize/registry tests; this stub isolates the export pipeline.
 */
const STUB_REGISTRY = {
  // topoSort is the only method the orchestrator touches in this slice
  topoSort: (domains: readonly string[]) => [...domains]
} as unknown as ReadonlyBackupRegistry

/** Create a fixture sqlite file with rows so the archive's backup.sqlite is verifiable. */
const makeFixtureDb = async (fixturePath: string): Promise<void> => {
  const db = new Database(fixturePath)
  db.exec('CREATE TABLE t(x INTEGER)')
  db.exec('INSERT INTO t VALUES (1), (2)')
  db.close()
}

const openZip = async (p: string) => {
  const zip = new StreamZip.async({ file: p })
  const entries = Object.keys(await zip.entries())
  return { zip, entries }
}

const newOrch = (dir: string, fixture: string) =>
  new ExportOrchestrator({ copier: new StubBackupCopier(fixture), registry: STUB_REGISTRY, tempDir: dir })

describe('ExportOrchestrator (full-preset DB-only slice)', () => {
  it('rejects the lite preset (gated off — needs contributor strip step)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-export-'))
    try {
      const fixture = join(dir, 'fixture.db')
      await makeFixtureDb(fixture)
      const out = join(dir, 'backup.cbu')
      const orch = newOrch(dir, fixture)

      // Act + Assert — lite is not supported this slice (would leak excluded-domain
      // rows without a contributor strip). Rejects loudly; produces nothing.
      await expect(
        orch.exportBackup({
          preset: 'lite',
          outputPath: out,
          restoreId: 'r1',
          producerAppVersion: '1.0.0',
          schemaMigrationId: '0001_x.sql'
        })
      ).rejects.toThrow(/lite/)
      expect(existsSync(out)).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a restoreId with path separators (path-traversal guard on the temp-copy path)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-export-'))
    try {
      const fixture = join(dir, 'fixture.db')
      await makeFixtureDb(fixture)
      const orch = newOrch(dir, fixture)

      // Act + Assert — a malicious '../escape' restoreId must NOT escape the temp
      // dir (it's joined into the temp-copy path → would let the copier overwrite
      // an arbitrary file). Each traversal variant rejects.
      for (const malicious of ['../escape', '..\\escape', 'a/b', '.', '..', 'a\0b']) {
        await expect(
          orch.exportBackup({
            preset: 'full',
            outputPath: join(dir, 'out.cbu'),
            restoreId: malicious,
            producerAppVersion: '1.0.0',
            schemaMigrationId: '0001_x.sql'
          })
        ).rejects.toThrow(/restoreId must be a safe basename/)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('exportBackup(full) produces a .cbu with manifest.json + backup.sqlite, all 14 domains, no files/', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-export-'))
    try {
      const fixture = join(dir, 'fixture.db')
      await makeFixtureDb(fixture)
      const out = join(dir, 'full.cbu')
      const orch = newOrch(dir, fixture)

      // Act
      const { manifest } = await orch.exportBackup({
        preset: 'full',
        outputPath: out,
        restoreId: 'r2',
        producerAppVersion: '1.0.0',
        schemaMigrationId: '0001_x.sql'
      })

      // Assert — manifest reflects the full preset
      expect(manifest.preset).toBe('full')
      expect(manifest.backupFormatVersion).toBe(1)
      expect(manifest.domains).toHaveLength(14)
      expect(new Set(manifest.domains)).toEqual(new Set(BACKUP_DOMAINS))
      expect(manifest.schemaMigrationId).toBe('0001_x.sql')
      // DB-only slice — blobs land with contributor export hooks
      expect(manifest.includeFiles).toBe(false)

      // Assert — archive layout: manifest.json + backup.sqlite, no files/ or knowledge/
      const { zip, entries } = await openZip(out)
      try {
        expect(entries).toContain('manifest.json')
        expect(entries).toContain('backup.sqlite')
        expect(entries.some((e) => e.startsWith('files/'))).toBe(false)
        expect(entries.some((e) => e.startsWith('knowledge/'))).toBe(false)

        // manifest.json inside the archive matches the returned manifest
        const m = JSON.parse((await zip.entryData('manifest.json')).toString())
        expect(m).toEqual(manifest)

        // backup.sqlite inside the archive carries the fixture data
        const extracted = join(dir, 'extracted.db')
        await zip.extract('backup.sqlite', extracted)
        const d = new Database(extracted, { readonly: true })
        try {
          const count = d.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }
          expect(count.c).toBe(2)
        } finally {
          d.close()
        }
      } finally {
        await zip.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('cleans up the temp DB copy after a successful archive', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-export-'))
    try {
      const fixture = join(dir, 'fixture.db')
      await makeFixtureDb(fixture)
      const out = join(dir, 'cleanup.cbu')
      const tempCopyPath = join(dir, 'r3.sqlite')
      const orch = newOrch(dir, fixture)

      await orch.exportBackup({
        preset: 'full',
        outputPath: out,
        restoreId: 'r3',
        producerAppVersion: '1.0.0',
        schemaMigrationId: '0001_x.sql'
      })

      // The temp copy must be removed once the archive is written
      expect(existsSync(tempCopyPath)).toBe(false)
      expect(existsSync(out)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('cleans up the temp copy even if archiving fails (write-stream error → reject, not hang)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-export-'))
    try {
      const fixture = join(dir, 'fixture.db')
      await makeFixtureDb(fixture)
      const tempCopyPath = join(dir, 'r4.sqlite')
      // An outputPath whose PARENT DIRECTORY does not exist — createWriteStream
      // emits 'error' (ENOENT) on open; without `output.on('error', reject)` the
      // archive promise would hang. This test exercises that path AND confirms the
      // temp copy is cleaned up despite the failure.
      const badOutput = join(dir, 'nonexistent-subdir', 'out.cbu')
      const orch = newOrch(dir, fixture)

      await expect(
        orch.exportBackup({
          preset: 'full',
          outputPath: badOutput,
          restoreId: 'r4',
          producerAppVersion: '1.0.0',
          schemaMigrationId: '0001_x.sql'
        })
      ).rejects.toThrow()
      expect(existsSync(tempCopyPath)).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
