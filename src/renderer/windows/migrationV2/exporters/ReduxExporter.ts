/**
 * Redux Persist data exporter for migration
 * Extracts persisted Redux state from localStorage and parses it for Main process
 */

const PERSIST_KEY = 'persist:cherry-studio'

// Redux slices that need to be migrated
const SLICES_TO_EXPORT = [
  'settings', // App settings and preferences
  'assistants', // Assistant configurations
  'knowledge', // Knowledge base metadata
  'llm', // LLM provider and model configurations
  'mcp', // MCP server configurations
  'minapps', // Mini app configurations (enabled/disabled/pinned)
  'note', // Note-related settings
  'selectionStore', // Selection assistant settings
  'preprocess', // File preprocess provider configurations
  'ocr', // OCR provider configurations
  'websearch', // Web search configurations
  'codeTools', // Code tools settings (CLI tool, models, terminal)
  'paintings' // Painting history per provider/mode (consumed by PaintingMigrator)
]

export interface ReduxExportResult {
  data: Record<string, unknown>
  slicesFound: string[]
  slicesMissing: string[]
}

export class ReduxExporter {
  /**
   * Export Redux Persist data from localStorage
   * Parses the nested JSON structure and returns clean data
   */
  export(): ReduxExportResult {
    const rawData = localStorage.getItem(PERSIST_KEY)

    if (!rawData) {
      return {
        data: {},
        slicesFound: [],
        slicesMissing: [...SLICES_TO_EXPORT]
      }
    }

    // Parse the outer JSON
    let persistedState: Record<string, string>
    try {
      persistedState = JSON.parse(rawData)
    } catch (error) {
      throw new Error(`Failed to parse Redux Persist root data: ${error}`)
    }

    // Parse each slice (Redux Persist stores each slice as a JSON string)
    const result: Record<string, unknown> = {}
    const slicesFound: string[] = []
    const slicesMissing: string[] = []

    for (const sliceName of SLICES_TO_EXPORT) {
      const sliceData = persistedState[sliceName]

      if (sliceData === undefined) {
        slicesMissing.push(sliceName)
        continue
      }

      try {
        // Each slice is stored as a JSON string
        result[sliceName] = JSON.parse(sliceData)
        slicesFound.push(sliceName)
      } catch (error) {
        // If parsing fails, store as-is (might be a primitive)
        result[sliceName] = sliceData
        slicesFound.push(sliceName)
      }
    }

    // Also include _persist metadata if present
    if (persistedState._persist) {
      try {
        result._persist = JSON.parse(persistedState._persist)
      } catch {
        result._persist = persistedState._persist
      }
    }

    return {
      data: result,
      slicesFound,
      slicesMissing
    }
  }

  /**
   * Get raw Redux Persist data for debugging
   */
  getRawData(): string | null {
    return localStorage.getItem(PERSIST_KEY)
  }

  /**
   * Check if Redux Persist data exists
   */
  hasData(): boolean {
    return localStorage.getItem(PERSIST_KEY) !== null
  }

  /**
   * Get list of all persisted slices
   */
  getPersistedSlices(): string[] {
    const rawData = localStorage.getItem(PERSIST_KEY)
    if (!rawData) return []

    try {
      const persistedState = JSON.parse(rawData)
      return Object.keys(persistedState).filter((key) => key !== '_persist')
    } catch {
      return []
    }
  }
}
