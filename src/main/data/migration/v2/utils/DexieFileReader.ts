/**
 * Dexie file reader for accessing exported Dexie table data
 * Dexie data is exported by Renderer to JSON files
 */

import fs from 'fs/promises'
import path from 'path'

import { JSONStreamReader } from './JSONStreamReader'

export class DexieFileReader {
  private exportPath: string

  constructor(exportPath: string) {
    this.exportPath = exportPath
  }

  /**
   * Get the export path
   */
  getExportPath(): string {
    return this.exportPath
  }

  /**
   * Read exported table data (for small tables)
   * @param tableName - Name of the table to read
   */
  async readTable<T>(tableName: string): Promise<T[]> {
    const filePath = path.join(this.exportPath, `${tableName}.json`)
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content)
  }

  /**
   * Create stream reader for large tables
   * Use this for tables with large amounts of data (e.g., messages)
   * @param tableName - Name of the table to stream
   */
  createStreamReader(tableName: string): JSONStreamReader {
    const filePath = path.join(this.exportPath, `${tableName}.json`)
    return new JSONStreamReader(filePath)
  }

  /**
   * Check if a table export file exists
   * @param tableName - Name of the table
   */
  async tableExists(tableName: string): Promise<boolean> {
    const filePath = path.join(this.exportPath, `${tableName}.json`)
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get file size for a table export
   * @param tableName - Name of the table
   */
  async getTableFileSize(tableName: string): Promise<number> {
    const filePath = path.join(this.exportPath, `${tableName}.json`)
    const stats = await fs.stat(filePath)
    return stats.size
  }
}
