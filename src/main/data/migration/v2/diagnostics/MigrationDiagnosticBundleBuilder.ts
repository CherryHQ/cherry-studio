import path from 'node:path'
import { type Readable, Transform } from 'node:stream'

import { type AtomicWriteStream, createAtomicWriteStream } from '@main/utils/file'
import {
  MIGRATION_DIAGNOSTIC_LARGE_ZIP_BYTES,
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
  type MigrationApplicationLogEntry,
  migrationDiagnosticRetryFor
} from './MigrationApplicationLogCollector'

interface MigrationDiagnosticApplicationMetadata {
  readonly version: string
  readonly platform: NodeJS.Platform
  readonly arch: string
}

export interface MigrationDiagnosticContext {
  readonly source: 'renderer' | 'native'
  readonly stage: MigrationStage | 'preboot'
  readonly errorSummary?: string
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

function migrationFailureDate(context: MigrationDiagnosticContext): Date | undefined {
  for (const timestamp of [context.run?.failedAt, context.run?.startedAt]) {
    if (timestamp === undefined) continue
    const date = new Date(timestamp)
    if (!Number.isNaN(date.getTime())) return date
  }
  return undefined
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
  return entry.handle.createReadStream({ start: 0, end: entry.snapshotBytes - 1, autoClose: false })
}

function exactLengthStream(source: Readable, expectedBytes: number): Readable {
  let emittedBytes = 0
  const output = new Transform({
    transform(chunk: Buffer | string, encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)
      const remaining = expectedBytes - emittedBytes
      if (remaining <= 0) {
        callback()
        return
      }
      const bounded = buffer.subarray(0, remaining)
      emittedBytes += bounded.length
      callback(null, bounded)
    },
    flush(callback) {
      if (emittedBytes === expectedBytes) {
        callback()
        return
      }
      callback(
        Object.assign(new Error(`Migration log snapshot ended after ${emittedBytes} of ${expectedBytes} bytes.`), {
          code: 'EIO'
        })
      )
    }
  })
  const forwardError = (error: unknown): void => {
    output.destroy(error as Error)
  }
  source.once('error', forwardError)
  output.once('close', () => {
    source.removeListener('error', forwardError)
    if (!source.destroyed && !source.readableEnded) source.destroy()
  })
  source.pipe(output)
  return output
}

async function writeArchive(
  destination: FilePath,
  diagnosticDocument: Buffer,
  logEntries: readonly MigrationApplicationLogEntry[],
  createLogReadStream: (entry: MigrationApplicationLogEntry) => Readable
): Promise<number> {
  let output: AtomicWriteStream | undefined
  let archive: ZipArchive | undefined
  try {
    output = createAtomicWriteStream(destination)
    archive = new ZipArchive({ zlib: { level: 1 }, zip64: true })
  } catch {
    await output?.abort().catch(() => undefined)
    throw new Error('bundle_save_failed')
  }

  return new Promise<number>((resolve, reject) => {
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
      resolve(archive.pointer())
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
          input = exactLengthStream(createLogReadStream(entry), entry.snapshotBytes)
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
      ...(context.errorSummary === undefined ? {} : { errorSummary: context.errorSummary }),
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
    retry: migrationDiagnosticRetryFor(failure.streamError),
    path: failure.filePath,
    error: serializeMigrationDiagnosticError(failure.streamError, failure.filePath)
  }
}

export function classifyMigrationDiagnosticArchiveSize(archiveBytes: number): 'standard' | 'large' {
  return archiveBytes > MIGRATION_DIAGNOSTIC_LARGE_ZIP_BYTES ? 'large' : 'standard'
}

export class MigrationDiagnosticBundleBuilder {
  private readonly clock: () => Date
  private readonly collectApplicationLogs?: (logsDirectory: string) => Promise<MigrationApplicationLogCollection>
  private readonly applicationMetadata?: MigrationDiagnosticApplicationMetadata
  private readonly createLogReadStream: (entry: MigrationApplicationLogEntry) => Readable

  constructor(options: MigrationDiagnosticBundleBuilderOptions = {}) {
    this.clock = options.clock ?? (() => new Date())
    this.collectApplicationLogs = options.collectApplicationLogs
    this.applicationMetadata = options.applicationMetadata
    this.createLogReadStream = options.createLogReadStream ?? defaultCreateLogReadStream
  }

  async save(input: MigrationDiagnosticBundleSaveInput): Promise<MigrationDiagnosticBundleSaveResult> {
    if (!isValidDestination(input.destination)) return failed()

    let collectedLogs: MigrationApplicationLogCollection | undefined
    try {
      const generatedAt = this.clock()
      collectedLogs = await this.collectLogs(input.logsDirectory, generatedAt, input.context)
      let logs = collectedLogs
      const application = this.applicationMetadata ?? {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch
      }

      let archiveSize: number
      try {
        archiveSize = await writeArchive(
          input.destination,
          diagnosticDocument(generatedAt, application, input.context, logs),
          logs.status === 'included' ? logs.entries : [],
          this.createLogReadStream
        )
      } catch (error) {
        if (logs.status !== 'included' || !(error instanceof MigrationLogStreamError)) throw error
        logs = streamFailureCollection(logs, error)
        archiveSize = await writeArchive(
          input.destination,
          diagnosticDocument(generatedAt, application, input.context, logs),
          [],
          this.createLogReadStream
        )
      }

      const size = classifyMigrationDiagnosticArchiveSize(archiveSize)
      return logs.status === 'included'
        ? { status: 'saved', logs: 'included', size }
        : { status: 'saved', logs: 'not_included', retry: logs.retry, size }
    } catch {
      return failed()
    } finally {
      if (collectedLogs?.status === 'included') {
        await Promise.allSettled(collectedLogs.entries.map((entry) => entry.handle.close()))
      }
    }
  }

  private async collectLogs(
    logsDirectory: string,
    saveTime: Date,
    context: MigrationDiagnosticContext
  ): Promise<MigrationApplicationLogCollection> {
    try {
      if (this.collectApplicationLogs !== undefined) return await this.collectApplicationLogs(logsDirectory)
      return await new MigrationApplicationLogCollector({
        logsDirectory,
        clock: () => saveTime,
        fallbackDate: migrationFailureDate(context)
      }).collect()
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
