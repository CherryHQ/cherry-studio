import type { Dirent } from 'node:fs'
import { readdir, stat as fsStat } from 'node:fs/promises'
import path from 'node:path'

import { type MigrationDiagnosticError, serializeMigrationDiagnosticError } from '@shared/data/migration/v2/diagnostics'

export const MAX_MIGRATION_DIAGNOSTIC_LOG_FILES = 4
export const MAX_MIGRATION_DIAGNOSTIC_RAW_LOG_BYTES = 40 * 1024 * 1024

export interface MigrationApplicationLogEntry {
  readonly fileName: string
  readonly filePath: string
  readonly mtimeMs: number
  readonly snapshotBytes: number
}

export interface MigrationApplicationLogOmission {
  readonly fileName: string
  readonly snapshotBytes: number
  readonly reason: 'budget_exceeded' | 'stream_failed'
}

export type MigrationApplicationLogCollection =
  | {
      readonly status: 'included'
      readonly completeness: 'complete' | 'partial'
      readonly entries: readonly MigrationApplicationLogEntry[]
      readonly omittedEntries: readonly MigrationApplicationLogOmission[]
      readonly includedRawBytes: number
    }
  | {
      readonly status: 'not_included'
      readonly completeness: 'none'
      readonly entries: readonly []
      readonly omittedEntries: readonly MigrationApplicationLogOmission[]
      readonly includedRawBytes: 0
      readonly reason:
        | 'no_eligible_logs'
        | 'directory_scan_failed'
        | 'file_read_failed'
        | 'collector_failed'
        | 'budget_exceeded'
      readonly retry: 'suggested' | 'not_suggested'
      readonly path: string
      readonly error?: MigrationDiagnosticError
    }

interface MigrationApplicationLogCollectorOptions {
  readonly logsDirectory: string
  readonly clock?: () => Date
  readonly statFile?: (filePath: string) => Promise<{ readonly size: number; readonly mtimeMs: number }>
}

function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const RETRYABLE_ERROR_CODES = new Set(['EAGAIN', 'EBUSY', 'EMFILE', 'ENFILE', 'ENOENT'])

function retryFor(error: unknown): 'suggested' | 'not_suggested' {
  const code =
    typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined
  return code !== undefined && RETRYABLE_ERROR_CODES.has(code) ? 'suggested' : 'not_suggested'
}

function omitted(
  reason: Exclude<MigrationApplicationLogCollection, { status: 'included' }>['reason'],
  targetPath: string,
  error?: unknown,
  omittedEntries: readonly MigrationApplicationLogOmission[] = []
): Exclude<MigrationApplicationLogCollection, { status: 'included' }> {
  return {
    status: 'not_included',
    completeness: 'none',
    entries: [],
    omittedEntries,
    includedRawBytes: 0,
    reason,
    retry: reason === 'no_eligible_logs' ? 'suggested' : retryFor(error),
    path: targetPath,
    ...(error === undefined ? {} : { error: serializeMigrationDiagnosticError(error, targetPath) })
  }
}

export class MigrationApplicationLogCollector {
  private readonly logsDirectory: string
  private readonly clock: () => Date
  private readonly statFile: (filePath: string) => Promise<{ readonly size: number; readonly mtimeMs: number }>

  constructor(options: MigrationApplicationLogCollectorOptions) {
    this.logsDirectory = options.logsDirectory
    this.clock = options.clock ?? (() => new Date())
    this.statFile = options.statFile ?? fsStat
  }

  async collect(): Promise<MigrationApplicationLogCollection> {
    try {
      const date = formatLocalDate(this.clock())
      const fileNamePattern = new RegExp(`^app\\.${date}\\.log(?:\\.\\d+)?$`)
      let directoryEntries: Dirent<string>[]
      try {
        directoryEntries = await readdir(this.logsDirectory, { withFileTypes: true })
      } catch (error) {
        return omitted('directory_scan_failed', this.logsDirectory, error)
      }

      const eligibleNames = directoryEntries
        .filter((entry) => entry.isFile() && fileNamePattern.test(entry.name))
        .map((entry) => entry.name)
      if (eligibleNames.length === 0) return omitted('no_eligible_logs', this.logsDirectory)

      const candidates: MigrationApplicationLogEntry[] = []
      for (const fileName of eligibleNames) {
        const filePath = path.join(this.logsDirectory, fileName)
        try {
          const fileStat = await this.statFile(filePath)
          candidates.push({ fileName, filePath, mtimeMs: fileStat.mtimeMs, snapshotBytes: fileStat.size })
        } catch (error) {
          return omitted('file_read_failed', filePath, error)
        }
      }
      candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || left.fileName.localeCompare(right.fileName))

      const entries: MigrationApplicationLogEntry[] = []
      const omittedEntries: MigrationApplicationLogOmission[] = []
      let includedRawBytes = 0
      for (const candidate of candidates) {
        const overBudget =
          entries.length >= MAX_MIGRATION_DIAGNOSTIC_LOG_FILES ||
          includedRawBytes + candidate.snapshotBytes > MAX_MIGRATION_DIAGNOSTIC_RAW_LOG_BYTES
        if (overBudget) {
          omittedEntries.push({
            fileName: candidate.fileName,
            snapshotBytes: candidate.snapshotBytes,
            reason: 'budget_exceeded'
          })
          continue
        }
        entries.push(candidate)
        includedRawBytes += candidate.snapshotBytes
      }

      if (entries.length === 0) {
        return omitted('budget_exceeded', this.logsDirectory, undefined, omittedEntries)
      }
      return {
        status: 'included',
        completeness: omittedEntries.length === 0 ? 'complete' : 'partial',
        entries,
        omittedEntries,
        includedRawBytes
      }
    } catch (error) {
      return omitted('collector_failed', this.logsDirectory, error)
    }
  }
}
