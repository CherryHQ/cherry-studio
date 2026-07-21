import path from 'node:path'

import { type AtomicWriteStream, createAtomicWriteStream } from '@main/utils/file'
import type { FilePath } from '@shared/types/file'
import { ZipArchive } from 'archiver'

import {
  type MigrationDatabaseDiagnosticResult,
  migrationDatabaseDiagnosticResultSchema
} from './migrationDatabaseDiagnosticsSchemas'
import { createMigrationDiagnosticBundleReadme } from './migrationDiagnosticBundleI18n'
import {
  MIGRATION_DIAGNOSTIC_BUNDLE_ENTRIES,
  MIGRATION_DIAGNOSTIC_BUNDLE_LIMIT_BYTES,
  type MigrationDiagnosticBundleDocument,
  migrationDiagnosticBundleDocumentSchema,
  type MigrationDiagnosticBundleEntryName
} from './migrationDiagnosticBundleSchemas'
import type { MigrationDiagnosticsSnapshot } from './MigrationDiagnosticsCoordinator'
import { migrationDiagnosticsCheckpointSchema } from './migrationDiagnosticsSchemas'

export { MIGRATION_DIAGNOSTIC_BUNDLE_ENTRIES, MIGRATION_DIAGNOSTIC_BUNDLE_LIMIT_BYTES }

const DATABASE_DIAGNOSTICS_UNAVAILABLE = Object.freeze({
  file: Object.freeze({ status: 'unreadable' as const, sqliteHeader: 'unavailable' as const }),
  sqlite: Object.freeze({ status: 'unavailable' as const, reason: 'not_attempted' as const })
})

interface MigrationDiagnosticArchiveEntry {
  readonly name: MigrationDiagnosticBundleEntryName
  readonly buffer: Buffer
}

interface MigrationDiagnosticBundleSaveInput {
  readonly destination: string
  readonly snapshot: MigrationDiagnosticsSnapshot
  readonly collectDatabaseDiagnostics: () => Promise<MigrationDatabaseDiagnosticResult>
}

export type MigrationDiagnosticBundleSaveResult =
  | { readonly status: 'saved'; readonly uncompressedBytes: number }
  | { readonly status: 'failed'; readonly code: 'bundle_save_failed' }

interface MigrationDiagnosticBundleBuilderOptions {
  readonly clock?: () => Date
}

function failed(): MigrationDiagnosticBundleSaveResult {
  return Object.freeze({ status: 'failed', code: 'bundle_save_failed' })
}

function validDestination(destination: string): destination is FilePath {
  if (destination.length === 0 || !path.isAbsolute(destination)) return false
  const basename = path.basename(destination)
  return basename.length > 0 && basename !== '.' && basename !== '..' && destination !== path.parse(destination).root
}

async function collectSafeDatabaseDiagnostics(
  collector: () => Promise<MigrationDatabaseDiagnosticResult>
): Promise<MigrationDatabaseDiagnosticResult> {
  try {
    const parsed = migrationDatabaseDiagnosticResultSchema.safeParse(await collector())
    return parsed.success ? parsed.data : DATABASE_DIAGNOSTICS_UNAVAILABLE
  } catch {
    return DATABASE_DIAGNOSTICS_UNAVAILABLE
  }
}

function createDocument(
  snapshot: MigrationDiagnosticsSnapshot,
  database: MigrationDatabaseDiagnosticResult,
  generatedAt: string
): MigrationDiagnosticBundleDocument {
  return migrationDiagnosticBundleDocumentSchema.parse({
    formatVersion: 1,
    generatedAt,
    app: snapshot.app,
    state: snapshot.state,
    ...(snapshot.previous === undefined ? {} : { previous: snapshot.previous }),
    ...(snapshot.current === undefined ? {} : { current: snapshot.current }),
    database
  })
}

function serializeEntries(
  document: MigrationDiagnosticBundleDocument,
  readme: string
): {
  readonly entries: readonly MigrationDiagnosticArchiveEntry[]
  readonly uncompressedBytes: number
} {
  const entries = [
    {
      name: 'migration-diagnostics.json' as const,
      buffer: Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8')
    },
    { name: 'README.txt' as const, buffer: Buffer.from(readme, 'utf8') }
  ]
  const uncompressedBytes = entries.reduce((total, entry) => total + entry.buffer.byteLength, 0)
  if (uncompressedBytes > MIGRATION_DIAGNOSTIC_BUNDLE_LIMIT_BYTES) throw new Error('bundle_too_large')
  return { entries, uncompressedBytes }
}

async function writeArchive(destination: FilePath, entries: readonly MigrationDiagnosticArchiveEntry[]): Promise<void> {
  let output: AtomicWriteStream
  let archive: ZipArchive
  try {
    output = createAtomicWriteStream(destination)
    archive = new ZipArchive({ zlib: { level: 9 } })
  } catch {
    throw new Error('bundle_save_failed')
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false

    const cleanup = (): void => {
      output.removeListener('finish', succeed)
      output.removeListener('error', fail)
      archive.removeListener('warning', fail)
      archive.removeListener('error', fail)
    }
    const succeed = (): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const fail = (): void => {
      if (settled) return
      settled = true
      cleanup()
      try {
        archive.abort()
      } catch {
        // The fixed save failure remains authoritative.
      }
      void output.abort().finally(() => reject(new Error('bundle_save_failed')))
    }

    output.once('finish', succeed)
    output.once('error', fail)
    archive.once('warning', fail)
    archive.once('error', fail)
    archive.pipe(output)

    try {
      for (const entry of entries) archive.append(entry.buffer, { name: entry.name })
      void archive.finalize().catch(fail)
    } catch {
      fail()
    }
  })
}

export class MigrationDiagnosticBundleBuilder {
  private readonly clock: () => Date

  constructor(options: MigrationDiagnosticBundleBuilderOptions = {}) {
    this.clock = options.clock ?? (() => new Date())
  }

  async save(input: MigrationDiagnosticBundleSaveInput): Promise<MigrationDiagnosticBundleSaveResult> {
    if (!validDestination(input.destination)) return failed()

    let snapshot: MigrationDiagnosticsSnapshot
    try {
      snapshot = migrationDiagnosticsCheckpointSchema.parse(input.snapshot)
    } catch {
      return failed()
    }

    const database = await collectSafeDatabaseDiagnostics(input.collectDatabaseDiagnostics)
    let serialized: ReturnType<typeof serializeEntries>
    try {
      const document = createDocument(snapshot, database, this.clock().toISOString())
      serialized = serializeEntries(document, await createMigrationDiagnosticBundleReadme())
    } catch {
      return failed()
    }

    try {
      await writeArchive(input.destination, serialized.entries)
      return Object.freeze({ status: 'saved', uncompressedBytes: serialized.uncompressedBytes })
    } catch {
      return failed()
    }
  }
}
