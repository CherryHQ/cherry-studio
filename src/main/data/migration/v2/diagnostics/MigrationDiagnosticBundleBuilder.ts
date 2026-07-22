import { createReadStream } from 'node:fs'
import path from 'node:path'
import type { Readable } from 'node:stream'

import { type AtomicWriteStream, createAtomicWriteStream, stat } from '@main/utils/file'
import {
  MIGRATION_DIAGNOSTIC_LARGE_ZIP_BYTES,
  type MigrationDiagnosticError,
  type MigrationDiagnosticFailure,
  type MigrationDiagnosticRun,
  type MigrationDiagnosticRuntime,
  type MigrationDiagnosticSavedResult,
  serializeMigrationDiagnosticError
} from '@shared/data/migration/v2/diagnostics'
import type { MigrationStage, MigratorStatus } from '@shared/data/migration/v2/types'
import type { FilePath } from '@shared/types/file'
import { ZipArchive } from 'archiver'
import { app } from 'electron'

import {
  type MigrationApplicationLogCollection,
  MigrationApplicationLogCollector,
  type MigrationApplicationLogEntry
} from './MigrationApplicationLogCollector'

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
  readonly error?: MigrationDiagnosticError
  readonly failure?: MigrationDiagnosticFailure
  readonly run?: MigrationDiagnosticRun
  readonly runtime?: MigrationDiagnosticRuntime
  readonly overallProgress?: number
  readonly migrators?: ReadonlyArray<{ readonly id: string; readonly status: MigratorStatus }>
}

interface MigrationDiagnosticBundleBuilderOptions {
  readonly clock?: () => Date
  readonly collectApplicationLogs?: (logsDirectory: string) => Promise<MigrationApplicationLogCollection>
  readonly applicationMetadata?: MigrationDiagnosticApplicationMetadata
  readonly getArchiveSize?: (destination: string) => Promise<number>
  readonly createLogReadStream?: (entry: MigrationApplicationLogEntry) => Readable
}

interface MigrationDiagnosticBundleSaveInput {
  readonly destination: string
  readonly logsDirectory: string
  readonly context: MigrationDiagnosticContext
}

type MigrationDiagnosticBundleSaveResult =
  | MigrationDiagnosticSavedResult
  | { readonly status: 'failed'; readonly code: 'bundle_save_failed' }

function failed(): MigrationDiagnosticBundleSaveResult {
  return { status: 'failed', code: 'bundle_save_failed' }
}

function isValidDestination(destination: string): destination is FilePath {
  if (!path.isAbsolute(destination)) return false
  const parsed = path.parse(destination)
  const basename = path.basename(destination)
  return destination !== parsed.root && basename !== '' && basename !== '.' && basename !== '..'
}

class MigrationLogStreamError extends Error {
  constructor(
    readonly filePath: string,
    readonly streamError: unknown
  ) {
    super('migration_log_stream_failed')
  }
}

function defaultCreateLogReadStream(entry: MigrationApplicationLogEntry): Readable {
  return createReadStream(entry.filePath, { start: 0, end: entry.snapshotBytes - 1 })
}

async function writeArchive(
  destination: FilePath,
  diagnosticDocument: Buffer,
  logEntries: readonly MigrationApplicationLogEntry[],
  createLogReadStream: (entry: MigrationApplicationLogEntry) => Readable
): Promise<void> {
  let output: AtomicWriteStream | undefined
  let archive: ZipArchive | undefined
  try {
    output = createAtomicWriteStream(destination)
    archive = new ZipArchive({ zlib: { level: 1 }, zip64: true })
  } catch {
    await output?.abort().catch(() => undefined)
    throw new Error('bundle_save_failed')
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false
    const activeStreams = new Map<Readable, (error: unknown) => void>()

    const cleanup = (): void => {
      output.removeListener('finish', succeed)
      output.removeListener('error', fail)
      archive.removeListener('warning', fail)
      archive.removeListener('error', fail)
      for (const [stream, listener] of activeStreams) stream.removeListener('error', listener)
      activeStreams.clear()
    }
    const succeed = (): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const fail = (error: unknown = new Error('bundle_save_failed')): void => {
      if (settled) return
      settled = true
      const streams = [...activeStreams.keys()]
      cleanup()
      for (const stream of streams) stream.destroy()
      try {
        archive.abort()
      } catch {
        // The original write or stream failure remains authoritative.
      }
      void output.abort().finally(() => reject(error))
    }

    output.once('finish', succeed)
    output.once('error', fail)
    archive.once('warning', fail)
    archive.once('error', fail)
    archive.pipe(output)

    try {
      archive.append(diagnosticDocument, { name: 'migration-diagnostics.json' })
      for (const entry of logEntries) {
        if (entry.snapshotBytes === 0) {
          archive.append(Buffer.alloc(0), { name: `logs/${entry.fileName}` })
          continue
        }
        let input: Readable
        try {
          input = createLogReadStream(entry)
        } catch (error) {
          fail(new MigrationLogStreamError(entry.filePath, error))
          return
        }
        const onError = (error: unknown): void => fail(new MigrationLogStreamError(entry.filePath, error))
        input.once('error', onError)
        activeStreams.set(input, onError)
        archive.append(input, { name: `logs/${entry.fileName}` })
      }
      void archive.finalize().catch(fail)
    } catch (error) {
      fail(error)
    }
  })
}

function logCollectionDocument(logs: MigrationApplicationLogCollection) {
  const base = {
    status: logs.status,
    completeness: logs.completeness,
    includedFiles:
      logs.status === 'included'
        ? logs.entries.map((entry) => ({ name: entry.fileName, bytes: entry.snapshotBytes }))
        : [],
    omittedFileCount: logs.omittedEntries.length,
    includedRawBytes: logs.includedRawBytes
  }
  if (logs.status === 'included') return base
  return {
    ...base,
    reason: logs.reason,
    retry: logs.retry,
    path: logs.path,
    ...(logs.error === undefined ? {} : { error: logs.error })
  }
}

function diagnosticDocument(
  generatedAt: Date,
  application: MigrationDiagnosticApplicationMetadata,
  context: MigrationDiagnosticContext,
  logs: MigrationApplicationLogCollection
): Buffer {
  const document = {
    formatVersion: 1,
    generatedAt: generatedAt.toISOString(),
    application,
    ...(context.runtime === undefined ? {} : { runtime: context.runtime }),
    migration: {
      source: context.source,
      stage: context.stage,
      ...(context.failureCode === undefined ? {} : { failureCode: context.failureCode }),
      ...(context.errorSummary === undefined ? {} : { errorSummary: context.errorSummary }),
      ...(context.error === undefined ? {} : { error: context.error }),
      ...(context.overallProgress === undefined ? {} : { overallProgress: context.overallProgress }),
      ...(context.migrators === undefined
        ? {}
        : { migrators: context.migrators.map(({ id, status }) => ({ id, status })) }),
      ...(context.run === undefined ? {} : { run: context.run }),
      ...(context.failure === undefined ? {} : { failure: context.failure })
    },
    logCollection: logCollectionDocument(logs)
  }
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8')
}

function streamFailureCollection(
  logs: Extract<MigrationApplicationLogCollection, { status: 'included' }>,
  failure: MigrationLogStreamError
): Exclude<MigrationApplicationLogCollection, { status: 'included' }> {
  return {
    status: 'not_included',
    completeness: 'none',
    entries: [],
    omittedEntries: [
      ...logs.entries.map((entry) => ({
        fileName: entry.fileName,
        snapshotBytes: entry.snapshotBytes,
        reason: 'stream_failed' as const
      })),
      ...logs.omittedEntries
    ],
    includedRawBytes: 0,
    reason: 'file_read_failed',
    retry: 'not_suggested',
    path: failure.filePath,
    error: serializeMigrationDiagnosticError(failure.streamError, failure.filePath)
  }
}

export class MigrationDiagnosticBundleBuilder {
  private readonly clock: () => Date
  private readonly collectApplicationLogs?: (logsDirectory: string) => Promise<MigrationApplicationLogCollection>
  private readonly applicationMetadata?: MigrationDiagnosticApplicationMetadata
  private readonly getArchiveSize: (destination: string) => Promise<number>
  private readonly createLogReadStream: (entry: MigrationApplicationLogEntry) => Readable

  constructor(options: MigrationDiagnosticBundleBuilderOptions = {}) {
    this.clock = options.clock ?? (() => new Date())
    this.collectApplicationLogs = options.collectApplicationLogs
    this.applicationMetadata = options.applicationMetadata
    this.getArchiveSize = options.getArchiveSize ?? (async (destination) => (await stat(destination as FilePath)).size)
    this.createLogReadStream = options.createLogReadStream ?? defaultCreateLogReadStream
  }

  async save(input: MigrationDiagnosticBundleSaveInput): Promise<MigrationDiagnosticBundleSaveResult> {
    if (!isValidDestination(input.destination)) return failed()

    try {
      const generatedAt = this.clock()
      let logs = await this.collectLogs(input.logsDirectory, generatedAt)
      const application = this.applicationMetadata ?? {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch
      }

      try {
        await writeArchive(
          input.destination,
          diagnosticDocument(generatedAt, application, input.context, logs),
          logs.status === 'included' ? logs.entries : [],
          this.createLogReadStream
        )
      } catch (error) {
        if (logs.status !== 'included' || !(error instanceof MigrationLogStreamError)) throw error
        logs = streamFailureCollection(logs, error)
        await writeArchive(
          input.destination,
          diagnosticDocument(generatedAt, application, input.context, logs),
          [],
          this.createLogReadStream
        )
      }

      const archiveSize = await this.getArchiveSize(input.destination)
      const size = archiveSize > MIGRATION_DIAGNOSTIC_LARGE_ZIP_BYTES ? 'large' : 'standard'
      return logs.status === 'included'
        ? { status: 'saved', logs: 'included', size }
        : { status: 'saved', logs: 'not_included', retry: logs.retry, size }
    } catch {
      return failed()
    }
  }

  private async collectLogs(logsDirectory: string, saveTime: Date): Promise<MigrationApplicationLogCollection> {
    try {
      if (this.collectApplicationLogs !== undefined) return await this.collectApplicationLogs(logsDirectory)
      return await new MigrationApplicationLogCollector({ logsDirectory, clock: () => saveTime }).collect()
    } catch (error) {
      return {
        status: 'not_included',
        completeness: 'none',
        entries: [],
        omittedEntries: [],
        includedRawBytes: 0,
        reason: 'collector_failed',
        retry: 'not_suggested',
        path: logsDirectory,
        error: serializeMigrationDiagnosticError(error, logsDirectory)
      }
    }
  }
}
