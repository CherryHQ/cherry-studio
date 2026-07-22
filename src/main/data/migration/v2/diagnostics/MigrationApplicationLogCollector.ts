import type { Dirent } from 'node:fs'
import { readdir, readFile as fsReadFile } from 'node:fs/promises'
import path from 'node:path'

import { type MigrationDiagnosticError, serializeMigrationDiagnosticError } from '@shared/data/migration/v2/diagnostics'

export interface MigrationApplicationLogEntry {
  readonly fileName: string
  readonly data: Buffer
}

export type MigrationApplicationLogCollection =
  | { readonly status: 'included'; readonly entries: readonly MigrationApplicationLogEntry[] }
  | {
      readonly status: 'not_included'
      readonly entries: readonly []
      readonly reason: 'no_eligible_logs' | 'directory_scan_failed' | 'file_read_failed' | 'collector_failed'
      readonly retry: 'suggested' | 'not_suggested'
      readonly path: string
      readonly error?: MigrationDiagnosticError
    }

interface MigrationApplicationLogCollectorOptions {
  readonly logsDirectory: string
  readonly clock?: () => Date
  readonly readFile?: (filePath: string) => Promise<Buffer>
}

interface SelectedLog {
  readonly fileName: string
  readonly rotation: number
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
  error?: unknown
): Exclude<MigrationApplicationLogCollection, { status: 'included' }> {
  return {
    status: 'not_included',
    entries: [],
    reason,
    retry: reason === 'no_eligible_logs' ? 'suggested' : retryFor(error),
    path: targetPath,
    ...(error === undefined ? {} : { error: serializeMigrationDiagnosticError(error, targetPath) })
  }
}

export class MigrationApplicationLogCollector {
  private readonly logsDirectory: string
  private readonly clock: () => Date
  private readonly readFile: (filePath: string) => Promise<Buffer>

  constructor(options: MigrationApplicationLogCollectorOptions) {
    this.logsDirectory = options.logsDirectory
    this.clock = options.clock ?? (() => new Date())
    this.readFile = options.readFile ?? fsReadFile
  }

  async collect(): Promise<MigrationApplicationLogCollection> {
    try {
      const date = formatLocalDate(this.clock())
      const baseFileName = `app.${date}.log`
      const fileNamePattern = new RegExp(`^app\\.${date}\\.log(?:\\.(\\d+))?$`)
      let directoryEntries: Dirent<string>[]
      try {
        directoryEntries = await readdir(this.logsDirectory, { withFileTypes: true })
      } catch (error) {
        return omitted('directory_scan_failed', this.logsDirectory, error)
      }
      const selectedLogs: SelectedLog[] = []

      for (const directoryEntry of directoryEntries) {
        if (!directoryEntry.isFile()) continue
        const match = fileNamePattern.exec(directoryEntry.name)
        if (match === null) continue
        selectedLogs.push({
          fileName: directoryEntry.name,
          rotation: directoryEntry.name === baseFileName ? -1 : Number(match[1])
        })
      }

      selectedLogs.sort((left, right) => left.rotation - right.rotation)
      if (selectedLogs.length === 0) return omitted('no_eligible_logs', this.logsDirectory)

      const entries: MigrationApplicationLogEntry[] = []
      for (const selectedLog of selectedLogs) {
        const logPath = path.join(this.logsDirectory, selectedLog.fileName)
        try {
          entries.push({ fileName: selectedLog.fileName, data: await this.readFile(logPath) })
        } catch (error) {
          return omitted('file_read_failed', logPath, error)
        }
      }
      return { status: 'included', entries }
    } catch (error) {
      return omitted('collector_failed', this.logsDirectory, error)
    }
  }
}
