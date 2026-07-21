import { readdir, readFile as fsReadFile } from 'node:fs/promises'
import path from 'node:path'

export interface MigrationApplicationLogEntry {
  readonly fileName: string
  readonly data: Buffer
}

export type MigrationApplicationLogCollection =
  | { readonly status: 'included'; readonly entries: readonly MigrationApplicationLogEntry[] }
  | { readonly status: 'not_included'; readonly entries: readonly [] }

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
      const directoryEntries = await readdir(this.logsDirectory, { withFileTypes: true })
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
      if (selectedLogs.length === 0) return { status: 'not_included', entries: [] }

      const entries: MigrationApplicationLogEntry[] = []
      for (const selectedLog of selectedLogs) {
        entries.push({
          fileName: selectedLog.fileName,
          data: await this.readFile(path.join(this.logsDirectory, selectedLog.fileName))
        })
      }
      return { status: 'included', entries }
    } catch {
      return { status: 'not_included', entries: [] }
    }
  }
}
