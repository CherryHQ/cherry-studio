import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { application } from '@application'
import { readAppliedChain } from '@data/db/restore/appliedChain'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { materializeMergedDatabase, MERGE_DEGRADATION_CODES } from '../mergeRestore'

describe('MERGE_DEGRADATION_CODES', () => {
  it.each(Object.entries(MERGE_DEGRADATION_CODES))('maps %s to its restore-facing code', (kind, code) => {
    // Identity, except the one consumer-neutral kind: on a restore the "remote"
    // side IS the backup, so the code names which side won instead.
    if (kind === 'remote_overwrote_local') expect(code).toBe('merge_backup_overwrote_local')
    else expect(code).toBe(`merge_${kind}`)
  })
})

describe('materializeMergedDatabase', () => {
  const dbh = setupTestDatabase()
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cs-merge-restore-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string) => {
      if (key === 'feature.agents.system_workspaces') return join(tmpDir, 'agents-system')
      throw new Error(`unexpected path key in mergeRestore test: ${key}`)
    })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('materializes a sealed merged file whose chain is the live chain, migrations untouched', async () => {
    const archivePath = join(tmpDir, 'admitted', 'backup.sqlite')
    mkdirSync(dirname(archivePath), { recursive: true })
    // Synthetic admitted archive: a faithful clone of the live schema (the chain
    // admission's migrate-forward would have produced) — the engine's read-only
    // backup side, identical in content to the live database.
    await dbh.sqlite.backup(archivePath)

    const liveChain = readAppliedChain(dbh.sqlite)
    const liveMigrationRows = countMigrationRows(dbh.sqlite)

    const output = await materializeMergedDatabase({
      archiveDbPath: archivePath,
      liveDbPath: harnessDbFilePath(dbh.sqlite),
      rebase: { producerPlatform: 'darwin', targetPlatform: 'darwin', pairings: [] },
      selfAttested: true
    })

    // The merge output took over the archive's slot, sealed: no WAL/SHM sidecar
    // may survive next to the file the journal will hash, and the work file must
    // have been renamed away rather than left behind.
    expect(existsSync(archivePath)).toBe(true)
    expect(existsSync(`${archivePath}-wal`)).toBe(false)
    expect(existsSync(`${archivePath}-shm`)).toBe(false)
    expect(readdirSync(dirname(archivePath)).filter((name) => name.startsWith('merge-work-'))).toEqual([])

    // Chain: non-empty, identical to the live chain, `__drizzle_migrations` rows
    // unchanged — the file promotion receives is a live-chain bundled prefix.
    const merged = new Database(archivePath, { readonly: true })
    try {
      const chain = readAppliedChain(merged)
      expect(chain.length).toBeGreaterThan(0)
      expect(chain).toEqual(liveChain)
      expect(countMigrationRows(merged)).toBe(liveMigrationRows)
    } finally {
      merged.close()
    }

    // Merging an archive with nothing new loses nothing: no reductions.
    expect(output.materialized.summary.degradations).toEqual([])
  })
})

/** Locate the harness's file-backed database path — the "live" database file. */
function harnessDbFilePath(sqlite: Database.Database): string {
  const rows = sqlite.pragma('database_list') as Array<{ name: string; file: string }>
  const main = rows.find((row) => row.name === 'main')
  if (!main?.file) throw new Error('harness database is not file-backed')
  return main.file
}

function countMigrationRows(sqlite: Database.Database): number {
  const row = sqlite.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as { n: number }
  return row.n
}
