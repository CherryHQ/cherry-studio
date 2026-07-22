import type { Dirent, Stats } from 'node:fs'
import { type FileHandle, lstat, open, readdir } from 'node:fs/promises'
import path from 'node:path'

import { type MigrationDiagnosticError, serializeMigrationDiagnosticError } from '@shared/data/migration/v2/diagnostics'

export interface MigrationApplicationLogEntry {
  readonly fileName: string
  readonly filePath: string
  readonly handle: FileHandle
  readonly mtimeMs: number
  readonly snapshotBytes: number
}

export interface MigrationApplicationLogOmission {
  readonly fileName: string
  readonly snapshotBytes: number
  readonly reason: 'stream_failed'
}

export type MigrationApplicationLogCollection =
  | {
      readonly status: 'included'
      readonly completeness: 'complete'
      readonly entries: readonly MigrationApplicationLogEntry[]
      readonly omittedEntries: readonly []
      readonly includedRawBytes: number
    }
  | {
      readonly status: 'not_included'
      readonly completeness: 'none'
      readonly entries: readonly []
      readonly omittedEntries: readonly MigrationApplicationLogOmission[]
      readonly includedRawBytes: 0
      readonly reason: 'no_eligible_logs' | 'directory_scan_failed' | 'file_read_failed' | 'collector_failed'
      readonly retry: 'suggested' | 'not_suggested'
      readonly path: string
      readonly error?: MigrationDiagnosticError
    }

interface MigrationApplicationLogCollectorOptions {
  readonly logsDirectory: string
  readonly clock?: () => Date
  readonly fallbackDate?: Date
  readonly lstatFile?: (filePath: string) => Promise<Stats>
  readonly openFile?: (filePath: string) => Promise<FileHandle>
}

function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const RETRYABLE_ERROR_CODES = new Set(['EAGAIN', 'EBUSY', 'EMFILE', 'ENFILE', 'ENOENT'])

export function migrationDiagnosticRetryFor(error: unknown): 'suggested' | 'not_suggested' {
  const code =
    typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined
  return code !== undefined && RETRYABLE_ERROR_CODES.has(code) ? 'suggested' : 'not_suggested'
}

function omitted(
  reason: Exclude<MigrationApplicationLogCollection, { status: 'included' }>['reason'],
  targetPath: string,
  error?: unknown
): Exclude<MigrationApplicationLogCollection, { status: 'included' }> {
  return {
    status: 'not_included',
    completeness: 'none',
    entries: [],
    omittedEntries: [],
    includedRawBytes: 0,
    reason,
    retry: reason === 'no_eligible_logs' ? 'suggested' : migrationDiagnosticRetryFor(error),
    path: targetPath,
    ...(error === undefined ? {} : { error: serializeMigrationDiagnosticError(error, targetPath) })
  }
}

function nonRegularFileError(filePath: string): Error & { code: string; syscall: string; path: string } {
  return Object.assign(new Error('Migration log is not a stable regular file.'), {
    code: 'EINVAL',
    syscall: 'lstat',
    path: filePath
  })
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

async function closeEntries(entries: readonly MigrationApplicationLogEntry[]): Promise<void> {
  await Promise.allSettled(entries.map((entry) => entry.handle.close()))
}

export class MigrationApplicationLogCollector {
  private readonly logsDirectory: string
  private readonly clock: () => Date
  private readonly fallbackDate?: Date
  private readonly lstatFile: (filePath: string) => Promise<Stats>
  private readonly openFile: (filePath: string) => Promise<FileHandle>

  constructor(options: MigrationApplicationLogCollectorOptions) {
    this.logsDirectory = options.logsDirectory
    this.clock = options.clock ?? (() => new Date())
    this.fallbackDate = options.fallbackDate
    this.lstatFile = options.lstatFile ?? lstat
    this.openFile = options.openFile ?? ((filePath) => open(filePath, 'r'))
  }

  async collect(): Promise<MigrationApplicationLogCollection> {
    const entries: MigrationApplicationLogEntry[] = []
    try {
      const date = formatLocalDate(this.clock())
      let directoryEntries: Dirent<string>[]
      try {
        directoryEntries = await readdir(this.logsDirectory, { withFileTypes: true })
      } catch (error) {
        return omitted('directory_scan_failed', this.logsDirectory, error)
      }

      const eligibleNamesFor = (localDate: string): string[] => {
        const fileNamePattern = new RegExp(`^app\\.${localDate}\\.log(?:\\.\\d+)?$`)
        return directoryEntries.filter((entry) => fileNamePattern.test(entry.name)).map((entry) => entry.name)
      }
      let eligibleNames = eligibleNamesFor(date)
      if (eligibleNames.length === 0 && this.fallbackDate !== undefined) {
        const fallbackDate = formatLocalDate(this.fallbackDate)
        if (fallbackDate !== date) eligibleNames = eligibleNamesFor(fallbackDate)
      }
      if (eligibleNames.length === 0) return omitted('no_eligible_logs', this.logsDirectory)

      for (const fileName of eligibleNames) {
        const filePath = path.join(this.logsDirectory, fileName)
        let handle: FileHandle | undefined
        try {
          const pathStat = await this.lstatFile(filePath)
          if (!pathStat.isFile()) throw nonRegularFileError(filePath)

          handle = await this.openFile(filePath)
          const handleStat = await handle.stat()
          if (!handleStat.isFile() || !sameFile(pathStat, handleStat)) throw nonRegularFileError(filePath)

          entries.push({
            fileName,
            filePath,
            handle,
            mtimeMs: handleStat.mtimeMs,
            snapshotBytes: handleStat.size
          })
        } catch (error) {
          await handle?.close().catch(() => undefined)
          await closeEntries(entries)
          return omitted('file_read_failed', filePath, error)
        }
      }

      entries.sort((left, right) => right.mtimeMs - left.mtimeMs || left.fileName.localeCompare(right.fileName))
      return {
        status: 'included',
        completeness: 'complete',
        entries,
        omittedEntries: [],
        includedRawBytes: entries.reduce((total, entry) => total + entry.snapshotBytes, 0)
      }
    } catch (error) {
      await closeEntries(entries)
      return omitted('collector_failed', this.logsDirectory, error)
    }
  }
}
