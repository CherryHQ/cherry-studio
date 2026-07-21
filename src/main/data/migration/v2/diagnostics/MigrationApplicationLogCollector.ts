import { lstat, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { LOGS_DIR } from '@main/core/paths/constants'

const APPLICATION_LOG_NAME = /^app\.\d{4}-\d{2}-\d{2}\.log(?:\.\d+)?$/

interface ApplicationLogCandidate {
  readonly name: string
  readonly modifiedAt: number
}

export class MigrationApplicationLogCollector {
  constructor(private readonly logsDir: string = LOGS_DIR) {}

  async collect(): Promise<Buffer | null> {
    try {
      const entries = await readdir(this.logsDir, { withFileTypes: true })
      const candidates: ApplicationLogCandidate[] = []

      for (const entry of entries) {
        if (!entry.isFile() || !APPLICATION_LOG_NAME.test(entry.name)) continue
        try {
          const stats = await lstat(path.join(this.logsDir, entry.name))
          if (stats.isFile()) candidates.push({ name: entry.name, modifiedAt: stats.mtimeMs })
        } catch {
          // The log may rotate between directory enumeration and inspection.
        }
      }

      candidates.sort((left, right) => right.modifiedAt - left.modifiedAt || right.name.localeCompare(left.name))
      for (const candidate of candidates) {
        try {
          return await readFile(path.join(this.logsDir, candidate.name))
        } catch {
          // Try the next newest log if rotation removed the selected file.
        }
      }
    } catch {
      // Application logs are optional diagnostic material.
    }

    return null
  }
}
