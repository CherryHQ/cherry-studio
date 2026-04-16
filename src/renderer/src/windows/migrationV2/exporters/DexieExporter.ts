/**
 * Dexie database exporter for migration
 * Exports IndexedDB tables to JSON files for Main process to read
 */

import { db } from '@renderer/databases'

// Required tables that must exist
const REQUIRED_TABLES = [
  'topics', // Contains messages embedded within each topic
  'files', // File metadata
  'knowledge_notes', // Individual knowledge note items
  'message_blocks' // Message block data
]

// Optional tables that may not exist in older versions
const OPTIONAL_TABLES = ['settings', 'translate_history', 'quick_phrases', 'translate_languages']

export interface ExportProgress {
  table: string
  progress: number
  total: number
}

export class DexieExporter {
  private exportPath: string

  constructor(exportPath: string) {
    this.exportPath = exportPath
  }

  /**
   * Export all Dexie tables to JSON files
   * @param onProgress - Progress callback
   * @returns Export path
   */
  async exportAll(onProgress?: (progress: ExportProgress) => void): Promise<string> {
    const existingTables = db.tables.map((t) => t.name)

    // No Dexie tables at all — fresh install, nothing to export
    if (existingTables.length === 0) {
      return this.exportPath
    }

    // Determine which tables to export (skip missing ones gracefully)
    const tablesToExport = [...REQUIRED_TABLES, ...OPTIONAL_TABLES].filter((t) => existingTables.includes(t))

    // Export each table
    for (let i = 0; i < tablesToExport.length; i++) {
      const tableName = tablesToExport[i]

      onProgress?.({
        table: tableName,
        progress: 0,
        total: tablesToExport.length
      })

      const data = await db.table(tableName).toArray()

      // Send data to Main process for writing
      // Uses IPC invoke with migration channel
      await window.electron.ipcRenderer.invoke(
        'migration:write-export-file',
        this.exportPath,
        tableName,
        JSON.stringify(data)
      )

      onProgress?.({
        table: tableName,
        progress: i + 1,
        total: tablesToExport.length
      })
    }

    return this.exportPath
  }

  /**
   * Get table counts for validation
   */
  async getTableCounts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {}

    for (const table of db.tables) {
      counts[table.name] = await table.count()
    }

    return counts
  }
}
