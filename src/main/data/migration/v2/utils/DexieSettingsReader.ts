/**
 * Synchronous reader for Dexie settings table data.
 *
 * Dexie's settings table is a simple KV store: { id: string, value: any }.
 * This reader pre-loads all records into a Map so that PreferencesMigrator
 * (and complex mappings) can access values synchronously, consistent with
 * ElectronStoreReader and ReduxStateReader.
 */

export interface DexieSettingsRecord {
  id: string
  value: unknown
}

export class DexieSettingsReader {
  private data: Map<string, unknown>

  constructor(records: DexieSettingsRecord[]) {
    this.data = new Map(records.map((r) => [r.id, r.value]))
  }

  /**
   * Get a value by its settings key
   * @param key - The settings id (e.g. 'translate:scroll:sync')
   */
  get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined
  }

  /**
   * Check if a key exists
   */
  has(key: string): boolean {
    return this.data.has(key)
  }

  /**
   * Get all available keys
   */
  keys(): string[] {
    return [...this.data.keys()]
  }

  /**
   * Get the total number of entries
   */
  get size(): number {
    return this.data.size
  }
}
