import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { ZipArchive } from 'archiver'
import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MIGRATION_DIAGNOSTIC_BUNDLE_ENTRIES,
  MIGRATION_DIAGNOSTIC_BUNDLE_LIMIT_BYTES,
  MigrationDiagnosticBundleBuilder
} from '../MigrationDiagnosticBundleBuilder'
import { migrationDiagnosticBundleDocumentSchema } from '../migrationDiagnosticBundleSchemas'
import {
  ACCEPTANCE_PRIVACY_CANARIES,
  createMigrationDiagnosticAcceptanceFixtures
} from './fixtures/migrationDiagnosticAcceptanceFixtures'

async function readZip(file: string): Promise<Map<string, Buffer>> {
  const zip = new StreamZip.async({ file })
  try {
    const entries = await zip.entries()
    const data = new Map<string, Buffer>()
    for (const name of Object.keys(entries)) data.set(name, await zip.entryData(name))
    return data
  } finally {
    await zip.close()
  }
}

describe('migration diagnostic acceptance matrix', () => {
  let testDir = ''

  beforeEach(() => {
    testDir = mkdtempSync(path.join(tmpdir(), 'cs-migration-diagnostic-acceptance-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(testDir, { recursive: true, force: true })
  })

  it.each(createMigrationDiagnosticAcceptanceFixtures())(
    '$name produces one bounded document with its real blocking signal',
    async (fixture) => {
      const destination = path.join(testDir, `${fixture.name}.zip`)
      const result = await new MigrationDiagnosticBundleBuilder().save({
        destination,
        snapshot: fixture.snapshot,
        collectDatabaseDiagnostics: fixture.collectDatabaseDiagnostics
      })

      expect(result.status).toBe('saved')
      if (result.status !== 'saved') throw new Error(`Expected ${fixture.name} to publish a diagnostic bundle`)
      const entries = await readZip(destination)
      expect([...entries.keys()]).toEqual([...MIGRATION_DIAGNOSTIC_BUNDLE_ENTRIES])
      const document = migrationDiagnosticBundleDocumentSchema.parse(
        JSON.parse(entries.get('migration-diagnostics.json')?.toString('utf8') ?? '')
      )
      expect(document.current?.status).toBe('failed')
      if (document.current?.status !== 'failed') throw new Error('Expected a failed current attempt')
      expect(document.current.failure.errorCode).toBe(fixture.expectedFailureCode)
      expect(document.database.sqlite).toMatchObject(fixture.expectedSqlite)
      const uncompressedBytes = [...entries.values()].reduce((total, entry) => total + entry.byteLength, 0)
      expect(uncompressedBytes).toBe(result.uncompressedBytes)
      expect(uncompressedBytes).toBeLessThanOrEqual(MIGRATION_DIAGNOSTIC_BUNDLE_LIMIT_BYTES)

      const allBytes = Buffer.concat([...entries.values()]).toString('utf8')
      for (const canary of ACCEPTANCE_PRIVACY_CANARIES) expect(allBytes).not.toContain(canary)
    }
  )

  it('uses one save failure while preserving an existing destination and removing temporary output', async () => {
    const fixture = createMigrationDiagnosticAcceptanceFixtures()[0]
    if (fixture === undefined) throw new Error('Expected at least one diagnostic acceptance fixture')
    const destination = path.join(testDir, 'archive-failure.zip')
    writeFileSync(destination, 'existing-support-artifact')
    vi.spyOn(ZipArchive.prototype, 'finalize').mockRejectedValueOnce(new Error('PRIVATE_ARCHIVE_FAILURE'))

    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: fixture.snapshot,
      collectDatabaseDiagnostics: fixture.collectDatabaseDiagnostics
    })

    expect(result).toEqual({ status: 'failed', code: 'bundle_save_failed' })
    expect(readFileSync(destination, 'utf8')).toBe('existing-support-artifact')
    expect(readdirSync(testDir).filter((name) => name.includes('.tmp-'))).toEqual([])
    expect(JSON.stringify(result)).not.toContain('PRIVATE_ARCHIVE_FAILURE')
  })
})
