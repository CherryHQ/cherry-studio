import {
  assertMigrationExportWriteSucceeded,
  type MigrationExportWriteResult
} from '@shared/data/migration/v2/diagnostics'
import { type LocalStorageRecord, MigrationIpcChannels } from '@shared/data/migration/v2/types'

export class LocalStorageExporter {
  private exportedCount = 0

  async export(): Promise<void> {
    const records: LocalStorageRecord[] = []

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key === null) continue

      const rawValue = localStorage.getItem(key)
      let value: unknown = rawValue

      // Try to parse JSON values
      if (rawValue !== null) {
        try {
          value = JSON.parse(rawValue)
        } catch {
          // Keep as string if not valid JSON
        }
      }

      records.push({ key, value })
    }

    this.exportedCount = records.length

    // Write via IPC (reuse existing WriteExportFile channel)
    const result = (await window.electron.ipcRenderer.invoke(MigrationIpcChannels.WriteExportFile, {
      target: 'local_storage',
      jsonData: JSON.stringify(records)
    })) as MigrationExportWriteResult
    assertMigrationExportWriteSucceeded(result)
  }

  hasData(): boolean {
    return localStorage.length > 0
  }

  getEntryCount(): number {
    return this.exportedCount
  }
}
