import type { LocalStorageRecord } from '@shared/data/migration/v2/types'

export class LocalStorageExporter {
  private exportPath: string
  private exportedCount = 0

  constructor(exportPath: string) {
    this.exportPath = exportPath
  }

  async export(): Promise<string> {
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
    await window.electron.ipcRenderer.invoke(
      'migration:write-export-file',
      this.exportPath,
      'localStorage',
      JSON.stringify(records)
    )

    return `${this.exportPath}/localStorage.json`
  }

  hasData(): boolean {
    return localStorage.length > 0
  }

  getEntryCount(): number {
    return this.exportedCount
  }
}
