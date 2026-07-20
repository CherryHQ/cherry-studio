import type { LocalStorageRecord } from '@shared/data/migration/v2/types'

import { RendererExportError } from './RendererExportError'

export class LocalStorageExporter {
  private exportPath: string
  private exportedCount = 0

  constructor(exportPath: string) {
    this.exportPath = exportPath
  }

  async export(): Promise<string> {
    const records: LocalStorageRecord[] = []

    try {
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
    } catch (error) {
      throw new RendererExportError({ sourceRole: 'local_storage', operationRole: 'read' }, error)
    }

    this.exportedCount = records.length

    let serialized: string
    try {
      serialized = JSON.stringify(records)
    } catch (error) {
      throw new RendererExportError({ sourceRole: 'local_storage', operationRole: 'serialize' }, error)
    }

    // Write via IPC (reuse existing WriteExportFile channel)
    try {
      await window.electron.ipcRenderer.invoke(
        'migration:write-export-file',
        this.exportPath,
        'localStorage',
        serialized
      )
    } catch (error) {
      throw new RendererExportError({ sourceRole: 'local_storage', operationRole: 'write' }, error)
    }

    return `${this.exportPath}/localStorage.json`
  }

  hasData(): boolean {
    return localStorage.length > 0
  }

  getEntryCount(): number {
    return this.exportedCount
  }
}
