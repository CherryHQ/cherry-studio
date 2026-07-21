import path from 'node:path'

import { type AtomicWriteStream, createAtomicWriteStream, stat } from '@main/utils/file'
import {
  MIGRATION_DIAGNOSTIC_LARGE_ZIP_BYTES,
  type MigrationDiagnosticSavedResult
} from '@shared/data/migration/v2/diagnostics'
import type { MigrationStage, MigratorStatus } from '@shared/data/migration/v2/types'
import type { FilePath } from '@shared/types/file'
import { ZipArchive } from 'archiver'
import { app } from 'electron'

import {
  type MigrationApplicationLogCollection,
  MigrationApplicationLogCollector
} from './MigrationApplicationLogCollector'
import { createMigrationDiagnosticBundleReadme } from './migrationDiagnosticBundleI18n'

interface MigrationDiagnosticApplicationMetadata {
  readonly version: string
  readonly platform: NodeJS.Platform
  readonly arch: string
}

export interface MigrationDiagnosticContext {
  readonly source: 'renderer' | 'native'
  readonly stage: MigrationStage | 'preboot'
  readonly failureCode?: string
  readonly errorSummary?: string
  readonly overallProgress?: number
  readonly migrators?: ReadonlyArray<{ readonly id: string; readonly status: MigratorStatus }>
}

interface MigrationDiagnosticBundleBuilderOptions {
  readonly clock?: () => Date
  readonly collectApplicationLogs?: (logsDirectory: string) => Promise<MigrationApplicationLogCollection>
  readonly applicationMetadata?: MigrationDiagnosticApplicationMetadata
  readonly getArchiveSize?: (destination: string) => Promise<number>
}

interface MigrationDiagnosticBundleSaveInput {
  readonly destination: string
  readonly logsDirectory: string
  readonly context: MigrationDiagnosticContext
}

type MigrationDiagnosticBundleSaveResult =
  | MigrationDiagnosticSavedResult
  | { readonly status: 'failed'; readonly code: 'bundle_save_failed' }

interface ArchiveEntry {
  readonly name: string
  readonly data: Buffer
}

function failed(): MigrationDiagnosticBundleSaveResult {
  return { status: 'failed', code: 'bundle_save_failed' }
}

function isValidDestination(destination: string): destination is FilePath {
  if (!path.isAbsolute(destination)) return false
  const parsed = path.parse(destination)
  const basename = path.basename(destination)
  return destination !== parsed.root && basename !== '' && basename !== '.' && basename !== '..'
}

async function writeArchive(destination: FilePath, entries: readonly ArchiveEntry[]): Promise<void> {
  let output: AtomicWriteStream | undefined
  let archive: ZipArchive | undefined
  try {
    output = createAtomicWriteStream(destination)
    archive = new ZipArchive({ zlib: { level: 9 }, zip64: true })
  } catch {
    await output?.abort().catch(() => undefined)
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
        // Keep the stable public save failure authoritative.
      }
      void output.abort().finally(() => reject(new Error('bundle_save_failed')))
    }

    output.once('finish', succeed)
    output.once('error', fail)
    archive.once('warning', fail)
    archive.once('error', fail)
    archive.pipe(output)

    try {
      for (const entry of entries) archive.append(entry.data, { name: entry.name })
      void archive.finalize().catch(fail)
    } catch {
      fail()
    }
  })
}

export class MigrationDiagnosticBundleBuilder {
  private readonly clock: () => Date
  private readonly collectApplicationLogs?: (logsDirectory: string) => Promise<MigrationApplicationLogCollection>
  private readonly applicationMetadata?: MigrationDiagnosticApplicationMetadata
  private readonly getArchiveSize: (destination: string) => Promise<number>

  constructor(options: MigrationDiagnosticBundleBuilderOptions = {}) {
    this.clock = options.clock ?? (() => new Date())
    this.collectApplicationLogs = options.collectApplicationLogs
    this.applicationMetadata = options.applicationMetadata
    this.getArchiveSize = options.getArchiveSize ?? (async (destination) => (await stat(destination as FilePath)).size)
  }

  async save(input: MigrationDiagnosticBundleSaveInput): Promise<MigrationDiagnosticBundleSaveResult> {
    if (!isValidDestination(input.destination)) return failed()

    try {
      const generatedAt = this.clock()
      const logs = await this.collectLogs(input.logsDirectory, generatedAt)
      const application = this.applicationMetadata ?? {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch
      }
      const document = {
        formatVersion: 1,
        generatedAt: generatedAt.toISOString(),
        application,
        migration: {
          source: input.context.source,
          stage: input.context.stage,
          ...(input.context.failureCode === undefined ? {} : { failureCode: input.context.failureCode }),
          ...(input.context.errorSummary === undefined ? {} : { errorSummary: input.context.errorSummary }),
          ...(input.context.overallProgress === undefined ? {} : { overallProgress: input.context.overallProgress }),
          ...(input.context.migrators === undefined
            ? {}
            : {
                migrators: input.context.migrators.map(({ id, status }) => ({ id, status }))
              })
        }
      }
      const archiveEntries: ArchiveEntry[] = [
        {
          name: 'migration-diagnostics.json',
          data: Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8')
        },
        { name: 'README.txt', data: Buffer.from(createMigrationDiagnosticBundleReadme(), 'utf8') }
      ]
      if (logs.status === 'included') {
        for (const entry of logs.entries) {
          archiveEntries.push({ name: `logs/${entry.fileName}`, data: entry.data })
        }
      }

      await writeArchive(input.destination, archiveEntries)
      const archiveSize = await this.getArchiveSize(input.destination)
      return {
        status: 'saved',
        logs: logs.status,
        size: archiveSize > MIGRATION_DIAGNOSTIC_LARGE_ZIP_BYTES ? 'large' : 'standard'
      }
    } catch {
      return failed()
    }
  }

  private async collectLogs(logsDirectory: string, saveTime: Date): Promise<MigrationApplicationLogCollection> {
    try {
      if (this.collectApplicationLogs !== undefined) return await this.collectApplicationLogs(logsDirectory)
      return await new MigrationApplicationLogCollector({ logsDirectory, clock: () => saveTime }).collect()
    } catch {
      return { status: 'not_included', entries: [] }
    }
  }
}
