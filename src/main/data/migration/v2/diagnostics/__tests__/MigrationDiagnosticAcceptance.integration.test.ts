import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createUniqueModelId } from '@shared/data/types/model'
import { ZipArchive } from 'archiver'
import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { evaluateCandidateVersion } from '../../core/versionPolicy'
import {
  MIGRATION_DATABASE_OBJECT_DEFINITIONS,
  type MigrationDatabaseDiagnosticResult
} from '../migrationDatabaseDiagnosticsSchemas'
import {
  MIGRATION_DIAGNOSTIC_BUNDLE_ENTRIES,
  MIGRATION_DIAGNOSTIC_BUNDLE_LIMIT_BYTES,
  MigrationDiagnosticBundleBuilder
} from '../MigrationDiagnosticBundleBuilder'
import {
  type MigrationDiagnosticBundleDocument,
  migrationDiagnosticBundleDocumentSchema
} from '../migrationDiagnosticBundleSchemas'
import { MigrationDiagnosticsCoordinator } from '../MigrationDiagnosticsCoordinator'
import type { MigrationDiagnosticFailure, MigrationDiagnosticsSnapshot } from '../migrationDiagnosticsSchemas'
import { classifyMigrationError } from '../migrationErrorClassifier'
import {
  ACCEPTANCE_PRIVACY_CANARIES,
  BLOCKING_FIXTURES,
  type BlockingMigrationDiagnosticAcceptanceFixture,
  createMigrationDiagnosticAcceptanceFixtures,
  SUPPORT_CHAIN_FIXTURES,
  type SupportChainMigrationDiagnosticAcceptanceFixture
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

function failureOf(
  snapshot: Pick<MigrationDiagnosticsSnapshot, 'current' | 'previous'>,
  attempt: 'current' | 'previous'
): MigrationDiagnosticFailure | undefined {
  const candidate = snapshot[attempt]
  return candidate?.status === 'failed' || candidate?.status === 'interrupted' ? candidate.failure : undefined
}

function expectNoMigrationRoot(snapshot: Pick<MigrationDiagnosticsSnapshot, 'current' | 'previous'>): void {
  expect(failureOf(snapshot, 'previous')).toBeUndefined()
  expect(failureOf(snapshot, 'current')).toBeUndefined()
}

function parseDocument(entries: Map<string, Buffer>): MigrationDiagnosticBundleDocument {
  return migrationDiagnosticBundleDocumentSchema.parse(
    JSON.parse(entries.get('migration-diagnostics.json')?.toString('utf8') ?? '')
  )
}

async function saveBundle(
  destination: string,
  snapshot: MigrationDiagnosticsSnapshot,
  collectDatabaseDiagnostics: () => Promise<MigrationDatabaseDiagnosticResult>
) {
  return new MigrationDiagnosticBundleBuilder({ clock: () => new Date('2026-07-21T09:00:00.000Z') }).save({
    destination,
    snapshot,
    collectDatabaseDiagnostics
  })
}

async function failedSnapshot(
  failure: Exclude<MigrationDiagnosticFailure, { kind: 'process_interrupted' }>
): Promise<MigrationDiagnosticsSnapshot> {
  const subject = new MigrationDiagnosticsCoordinator({
    appVersion: '2.0.0',
    platform: 'darwin',
    arch: 'arm64',
    clock: () => new Date('2026-07-21T08:00:00.000Z')
  })
  subject.beginAttempt('initial')
  subject.updateLocation({
    scope: failure.scope,
    phase: failure.phase,
    ...('migratorId' in failure && failure.migratorId !== undefined ? { migratorId: failure.migratorId } : {})
  })
  subject.finishAttempt({ status: 'failed', failure })
  return subject.snapshot()
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

  const fixtures = createMigrationDiagnosticAcceptanceFixtures()
  const blockingFixtures = fixtures.filter(
    (fixture): fixture is BlockingMigrationDiagnosticAcceptanceFixture => fixture.role !== 'support_chain'
  )
  const supportFixtures = fixtures.filter(
    (fixture): fixture is SupportChainMigrationDiagnosticAcceptanceFixture => fixture.role === 'support_chain'
  )

  it('defines exactly twelve blocking/process fixtures and two non-root support fixtures', () => {
    expect(blockingFixtures.map(({ name }) => name)).toEqual([...BLOCKING_FIXTURES])
    expect(supportFixtures.map(({ name }) => name)).toEqual([...SUPPORT_CHAIN_FIXTURES])
    expect(new Set(fixtures.map(({ name }) => name)).size).toBe(14)
  })

  it.each(blockingFixtures)('$name preserves one bounded blocking root in a real two-entry ZIP', async (fixture) => {
    const snapshot = await fixture.createSnapshot(testDir)
    const expectedFailure = failureOf(snapshot, fixture.expectedRoot.attempt)
    expect(expectedFailure?.errorCode).toBe(fixture.expectedRoot.errorCode)
    if (fixture.role === 'blocking_root') expect(expectedFailure?.kind).not.toBe('process_interrupted')
    else expect(expectedFailure?.kind).toBe('process_interrupted')

    const destination = path.join(testDir, `${fixture.name}.zip`)
    const result = await saveBundle(destination, snapshot, fixture.collectDatabaseDiagnostics)

    expect(result.status).toBe('saved')
    if (result.status !== 'saved') throw new Error(`Expected ${fixture.name} to publish a diagnostic bundle`)
    const entries = await readZip(destination)
    expect([...entries.keys()]).toEqual([...MIGRATION_DIAGNOSTIC_BUNDLE_ENTRIES])
    const document = parseDocument(entries)
    expect(document.formatVersion).toBe(2)
    expect(failureOf(document, fixture.expectedRoot.attempt)?.errorCode).toBe(fixture.expectedRoot.errorCode)
    expect(document.database.sqlite).toMatchObject(fixture.expectedSqlite)
    if (document.database.sqlite.status === 'available') {
      expect(document.database.sqlite.objects).toEqual(
        expect.arrayContaining(
          MIGRATION_DATABASE_OBJECT_DEFINITIONS.map(({ role, table, columns }) =>
            expect.objectContaining({ role, tableName: table, standardColumns: columns })
          )
        )
      )
      expect(document.database.sqlite.objects).toHaveLength(36)
    }
    const uncompressedBytes = [...entries.values()].reduce((total, entry) => total + entry.byteLength, 0)
    expect(uncompressedBytes).toBe(result.uncompressedBytes)
    expect(uncompressedBytes).toBeLessThanOrEqual(MIGRATION_DIAGNOSTIC_BUNDLE_LIMIT_BYTES)

    const allBytes = Buffer.concat([...entries.values()]).toString('utf8')
    for (const canary of ACCEPTANCE_PRIVACY_CANARIES) expect(allBytes).not.toContain(canary)
  })

  it('keeps a child partial/hang result in the support chain without inventing a migration root', async () => {
    const fixture = supportFixtures.find(({ name }) => name === 'database-process-partial')
    if (fixture === undefined) throw new Error('Expected the database process support fixture')
    const snapshot = await fixture.createSnapshot(testDir)
    expectNoMigrationRoot(snapshot)
    const destination = path.join(testDir, `${fixture.name}.zip`)

    const result = await saveBundle(destination, snapshot, fixture.collectDatabaseDiagnostics)

    expect(result.status).toBe(fixture.expectedSaveStatus)
    const entries = await readZip(destination)
    const document = parseDocument(entries)
    expectNoMigrationRoot(document)
    expect(document.database.sqlite).toMatchObject(fixture.expectedSqlite)
  })

  it('uses one save failure without creating a migration root or replacing an existing destination', async () => {
    const fixture = supportFixtures.find(({ name }) => name === 'archive-finalization-failure')
    if (fixture === undefined) throw new Error('Expected the archive support fixture')
    const snapshot = await fixture.createSnapshot(testDir)
    expectNoMigrationRoot(snapshot)
    expect(fixture.failArchiveFinalization).toBe(true)
    const destination = path.join(testDir, `${fixture.name}.zip`)
    writeFileSync(destination, 'existing-support-artifact')
    vi.spyOn(ZipArchive.prototype, 'finalize').mockRejectedValueOnce(new Error('PRIVATE_ARCHIVE_FAILURE'))

    const result = await saveBundle(destination, snapshot, fixture.collectDatabaseDiagnostics)

    expect(result).toEqual({ status: 'failed', code: 'bundle_save_failed' })
    expect(result.status).toBe(fixture.expectedSaveStatus)
    expect(readFileSync(destination, 'utf8')).toBe('existing-support-artifact')
    expect(readdirSync(testDir).filter((name) => name.includes('.tmp-'))).toEqual([])
    expect(JSON.stringify(result)).not.toContain('PRIVATE_ARCHIVE_FAILURE')
  })

  it.each([
    ['read', 'source_read_failed'],
    ['write', 'unknown_error'],
    ['unknown', 'unknown_error']
  ] as const)(
    'saves a strict Dexie/unknown %s handoff report without the renderer message',
    async (operationRole, errorCode) => {
      const evidence =
        operationRole === 'unknown'
          ? ({ kind: 'renderer_export', sourceRole: 'unknown', operationRole: 'unknown' } as const)
          : ({ kind: 'renderer_export', sourceRole: 'dexie', operationRole } as const)
      const snapshot = await failedSnapshot({
        kind: 'renderer_export_failed',
        scope: 'renderer_export',
        phase: 'finalize',
        errorCode,
        evidence
      })
      const destination = path.join(testDir, `renderer-${operationRole}.zip`)

      const result = await saveBundle(destination, snapshot, async () => {
        throw new Error('PRIVATE_RENDERER_MESSAGE_/Users/alice')
      })

      expect(result.status).toBe('saved')
      const entries = await readZip(destination)
      const document = parseDocument(entries)
      expect(document.current).toMatchObject({
        status: 'failed',
        failure: {
          errorCode,
          evidence
        }
      })
      expect(Buffer.concat([...entries.values()]).toString('utf8')).not.toContain('PRIVATE_RENDERER_MESSAGE')
    }
  )

  it('saves only the fixed rule from an actual reserved model-identifier rejection', async () => {
    const providerId = 'provider'
    const modelId = 'PRIVATE_MODEL?TOKEN_CANARY'
    let cause: unknown
    try {
      createUniqueModelId(providerId, modelId)
    } catch (error) {
      cause = error
    }
    const classification = classifyMigrationError(cause)
    expect(classification).toMatchObject({
      errorCode: 'source_invalid_identifier',
      identifierViolation: { identifierRole: 'model_id', rule: 'contains_reserved_route_character' }
    })
    if (classification.identifierViolation === undefined) throw new Error('Expected a fixed identifier violation')
    const snapshot = await failedSnapshot({
      kind: 'migration_invariant_failed',
      scope: 'migrator',
      phase: 'execute',
      migratorId: 'provider_model',
      errorCode: 'source_invalid_identifier',
      evidence: { kind: 'invariant', invariantRole: 'identifier', ...classification.identifierViolation }
    })
    const destination = path.join(testDir, 'reserved-model-id.zip')

    await expect(
      saveBundle(destination, snapshot, async () => {
        throw new Error('database not initialized')
      })
    ).resolves.toMatchObject({ status: 'saved' })

    const entries = await readZip(destination)
    expect(parseDocument(entries).current).toMatchObject({
      failure: {
        errorCode: 'source_invalid_identifier',
        evidence: {
          kind: 'invariant',
          invariantRole: 'identifier',
          identifierRole: 'model_id',
          rule: 'contains_reserved_route_character'
        }
      }
    })
    expect(Buffer.concat([...entries.values()]).toString('utf8')).not.toContain(modelId)
  })

  it('uses the actual missing-version policy result in a saved version-block ZIP', async () => {
    const evaluation = evaluateCandidateVersion(testDir, '2.0.0')
    expect(evaluation.check).toMatchObject({ outcome: 'block', reason: 'no_version_log' })
    if (evaluation.check.outcome !== 'block' || evaluation.check.reason !== 'no_version_log') {
      throw new Error('Expected a no_version_log block')
    }
    const snapshot = await failedSnapshot({
      kind: 'upgrade_path_blocked',
      scope: 'gate',
      phase: 'validate',
      errorCode: 'no_version_log',
      evidence: {
        kind: 'version_gate',
        context: {
          reason: 'no_version_log',
          currentVersion: '2.0.0',
          directorySelectionRole: 'default',
          previousVersion: null,
          requiredVersion: evaluation.check.details.requiredVersion,
          gatewayVersion: null,
          versionLog: evaluation.versionLog
        }
      }
    })
    const destination = path.join(testDir, 'missing-version-log.zip')

    await expect(
      saveBundle(destination, snapshot, async () => {
        throw new Error('database not initialized')
      })
    ).resolves.toMatchObject({ status: 'saved' })

    expect(parseDocument(await readZip(destination)).current).toMatchObject({
      failure: {
        errorCode: 'no_version_log',
        evidence: { context: { versionLog: { state: 'missing' } } }
      }
    })
  })

  it('selects the latest valid 1.9.11 record and saves only bounded version-log facts', async () => {
    const privateLine = 'PRIVATE_INVALID_VERSION_/Users/alice'
    writeFileSync(
      path.join(testDir, 'version.log'),
      [
        '1.8.4|darwin|production|true|normal|2026-01-01T00:00:00Z',
        privateLine,
        '1.9.11|darwin|production|true|normal|2026-02-01T00:00:00Z',
        '2.0.0|darwin|production|true|normal|2026-03-01T00:00:00Z'
      ].join('\n')
    )

    const evaluation = evaluateCandidateVersion(testDir, '2.0.0')

    expect(evaluation.previousVersion).toBe('1.9.11')
    expect(evaluation.versionLog).toEqual({
      state: 'parsed',
      validRecordCountBucket: '2+',
      invalidRecordCountBucket: '1'
    })
    if (
      evaluation.check.outcome !== 'block' ||
      evaluation.check.reason !== 'v1_too_old' ||
      evaluation.previousVersion === null
    ) {
      throw new Error('Expected the selected 1.9.11 version to remain below the required gateway')
    }
    const snapshot = await failedSnapshot({
      kind: 'upgrade_path_blocked',
      scope: 'gate',
      phase: 'validate',
      errorCode: 'v1_too_old',
      evidence: {
        kind: 'version_gate',
        context: {
          reason: 'v1_too_old',
          currentVersion: '2.0.0',
          directorySelectionRole: 'default',
          previousVersion: evaluation.previousVersion,
          requiredVersion: evaluation.check.details.requiredVersion,
          gatewayVersion: null,
          versionLog: evaluation.versionLog
        }
      }
    })
    const destination = path.join(testDir, 'latest-valid-version.zip')
    await saveBundle(destination, snapshot, async () => {
      throw new Error('database not initialized')
    })

    const entries = await readZip(destination)
    const serialized = Buffer.concat([...entries.values()]).toString('utf8')
    expect(parseDocument(entries).current).toMatchObject({
      failure: {
        evidence: {
          context: {
            previousVersion: '1.9.11',
            versionLog: { validRecordCountBucket: '2+', invalidRecordCountBucket: '1' }
          }
        }
      }
    })
    expect(serialized).not.toContain(privateLine)
    expect(serialized).not.toContain('2026-01-01')
    expect(serialized).not.toContain(testDir)
  })
})
