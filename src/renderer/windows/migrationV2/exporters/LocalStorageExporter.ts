import {
  type LocalStorageRecord,
  MIGRATION_LOCAL_STORAGE_KEYS,
  MigrationIpcChannels
} from '@shared/data/migration/v2/types'

export class LocalStorageExporter {
  private exportPath: string
  private exportedCount = 0

  constructor(exportPath: string) {
    this.exportPath = exportPath
  }

  async export(): Promise<string> {
    this.exportedCount = 0
    await window.electron.ipcRenderer.invoke(
      MigrationIpcChannels.WriteExportFile,
      this.exportPath,
      'localStorage',
      '[',
      'overwrite'
    )

    for (const key of MIGRATION_LOCAL_STORAGE_KEYS) {
      const rawValue = localStorage.getItem(key)
      if (rawValue === null) continue
      let value: unknown = rawValue

      // Try to parse JSON values
      if (rawValue !== null) {
        try {
          value = JSON.parse(rawValue)
        } catch {
          // Keep as string if not valid JSON
        }
      }

      const record: LocalStorageRecord = { key, value }
      await window.electron.ipcRenderer.invoke(
        MigrationIpcChannels.WriteExportFile,
        this.exportPath,
        'localStorage',
        `${this.exportedCount > 0 ? ',' : ''}${JSON.stringify(record)}`,
        'append'
      )
      this.exportedCount += 1
    }

    await window.electron.ipcRenderer.invoke(
      MigrationIpcChannels.WriteExportFile,
      this.exportPath,
      'localStorage',
      ']',
      'append'
    )

    return `${this.exportPath}/localStorage.json`
  }

  hasData(): boolean {
    return MIGRATION_LOCAL_STORAGE_KEYS.some((key) => localStorage.getItem(key) !== null)
  }

  getEntryCount(): number {
    return this.exportedCount
  }
}
