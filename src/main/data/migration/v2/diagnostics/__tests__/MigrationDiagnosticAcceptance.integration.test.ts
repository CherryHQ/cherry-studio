import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { ZipArchive } from 'archiver'
import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MIGRATION_DIAGNOSTIC_STRICT_ENTRIES,
  MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES,
  MigrationDiagnosticBundleBuilder
} from '../MigrationDiagnosticBundleBuilder'
import {
  migrationDatabaseDiagnosticsDocumentSchema,
  migrationDiagnosticEventsDocumentSchema,
  migrationDiagnosticManifestSchema
} from '../migrationDiagnosticBundleSchemas'
import {
  ACCEPTANCE_FORBIDDEN_CONTENT,
  ACCEPTANCE_PRIVACY_CANARIES,
  createMigrationDiagnosticAcceptanceFixtures
} from './fixtures/migrationDiagnosticAcceptanceFixtures'

async function readZip(file: string) {
  const zip = new StreamZip.async({ file })
  try {
    const entries = await zip.entries()
    const data = new Map<string, Buffer>()
    for (const name of Object.keys(entries)) data.set(name, await zip.entryData(name))
    return { entries, data }
  } finally {
    await zip.close()
  }
}

describe('strict diagnostic acceptance matrix', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(path.join(tmpdir(), 'cs-migration-diagnostic-acceptance-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(testDir, { recursive: true, force: true })
  })

  it.each(createMigrationDiagnosticAcceptanceFixtures())(
    '$name produces a private bounded bundle with actionable fixed location signals',
    async (fixture) => {
      const destination = path.join(testDir, `${fixture.name}.zip`)
      const result = await new MigrationDiagnosticBundleBuilder().save({
        destination,
        snapshot: fixture.snapshot,
        collectDatabaseDiagnostics: fixture.collectDatabaseDiagnostics
      })

      expect(result.status).toBe('saved')
      if (result.status !== 'saved') throw new Error(`Expected ${fixture.name} to publish a strict bundle`)

      const archive = await readZip(destination)
      const names = Object.keys(archive.entries)
      expect(names).toEqual([...MIGRATION_DIAGNOSTIC_STRICT_ENTRIES])
      expect(Object.values(archive.entries).every((entry) => entry.isFile && !entry.isDirectory)).toBe(true)
      expect(names.every((name) => !name.includes('/') && !name.includes('\\'))).toBe(true)

      const manifest = migrationDiagnosticManifestSchema.parse(
        JSON.parse(archive.data.get('manifest.json')?.toString('utf8') ?? '')
      )
      const events = migrationDiagnosticEventsDocumentSchema.parse(
        JSON.parse(archive.data.get('migration-events.json')?.toString('utf8') ?? '')
      )
      const database = migrationDatabaseDiagnosticsDocumentSchema.parse(
        JSON.parse(archive.data.get('database-diagnostics.json')?.toString('utf8') ?? '')
      )
      const uncompressedBytes = [...archive.data.values()].reduce((total, entry) => total + entry.byteLength, 0)
      expect(uncompressedBytes).toBe(result.uncompressedBytes)
      expect(uncompressedBytes).toBe(manifest.totalUncompressedBytes)
      expect(uncompressedBytes).toBeLessThanOrEqual(MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES)
      expect(manifest.entries).toEqual(
        MIGRATION_DIAGNOSTIC_STRICT_ENTRIES.map((name) => ({
          name,
          uncompressedBytes: archive.data.get(name)?.byteLength
        }))
      )

      const locationEvent = events.attempts
        .flatMap((attempt) => attempt.events)
        .find(
          (event) =>
            event.category === fixture.expected.category &&
            event.code === fixture.expected.code &&
            event.scope === fixture.expected.scope &&
            event.phase === fixture.expected.phase &&
            event.migratorId === fixture.expected.migratorId
        )
      expect(locationEvent).toBeDefined()

      if (fixture.expected.payload !== undefined) {
        expect(locationEvent?.payloadProfile).toMatchObject({
          target: fixture.expected.payload.target,
          traversal: fixture.expected.payload.traversal
        })
        const slot = locationEvent?.payloadProfile?.slots.find(
          (candidate) => candidate.slot === fixture.expected.payload?.slot
        )
        expect(slot).toMatchObject(fixture.expected.payload.profile)
      }

      expect(events.attempts.map((attempt) => attempt.trigger)).toEqual(fixture.expected.attemptTriggers)
      expect(database.completion).toMatchObject(fixture.expected.database.completion)
      if (fixture.expected.database.level !== undefined) {
        const levelResult = fixture.expected.database.levelResult
        if (levelResult === undefined) throw new Error(`Missing expected level result for ${fixture.name}`)
        expect(database.levels[fixture.expected.database.level]).toMatchObject(levelResult)
      }
      if (fixture.expected.database.object !== undefined) {
        const l1 = database.levels.l1
        expect(l1?.details.status).toBe('included')
        if (l1?.details.status === 'included') {
          expect(l1.details.data.objects).toContainEqual(expect.objectContaining(fixture.expected.database.object))
        }
      }
      if (fixture.expected.database.foreignKey !== undefined) {
        const l2 = database.levels.l2
        expect(l2?.details.status).toBe('included')
        if (l2?.details.status === 'included') {
          expect(l2.details.data.foreignKeys.violations).toContainEqual(
            expect.objectContaining(fixture.expected.database.foreignKey)
          )
        }
      }

      const allBytes = Buffer.concat([...archive.data.values()]).toString('utf8')
      for (const canary of ACCEPTANCE_PRIVACY_CANARIES) expect(allBytes).not.toContain(canary)
      for (const forbidden of ACCEPTANCE_FORBIDDEN_CONTENT) expect(allBytes).not.toContain(forbidden)
    }
  )

  it('reports archive failure without replacing the destination or leaving a partial ZIP to score', async () => {
    const fixture = createMigrationDiagnosticAcceptanceFixtures()[0]
    if (fixture === undefined) throw new Error('Expected at least one diagnostic acceptance fixture')
    const destination = path.join(testDir, 'archive-failure.zip')
    const oldDestination = Buffer.from('existing-support-artifact', 'utf8')
    writeFileSync(destination, oldDestination, { mode: 0o600 })
    vi.spyOn(ZipArchive.prototype, 'finalize').mockRejectedValueOnce(new Error('PRIVATE_ARCHIVE_FAILURE_/Users/alice'))

    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination,
      snapshot: fixture.snapshot,
      collectDatabaseDiagnostics: fixture.collectDatabaseDiagnostics
    })

    expect(result).toEqual({ status: 'failed', code: 'archive_failed', publication: 'not_published' })
    expect(readFileSync(destination)).toEqual(oldDestination)
    expect(existsSync(`${destination}.partial`)).toBe(false)
    expect(JSON.stringify(result)).not.toContain('PRIVATE_ARCHIVE_FAILURE')
  })
})
