/**
 * Redux state reader for accessing Redux Persist data
 * Data is parsed by Renderer before IPC transfer
 */

export class ReduxStateReader {
  private data: Record<string, unknown>

  constructor(rawData: Record<string, unknown>) {
    this.data = rawData
  }

  /**
   * Read value from Redux state with nested path support
   * @param category - Top-level category (e.g., 'settings', 'assistants')
   * @param key - Key within category, supports dot notation (e.g., 'codeEditor.enabled')
   * @returns The value or undefined if not found
   * @example
   * reader.get('settings', 'codeEditor.enabled')
   * reader.get('assistants', 'defaultAssistant')
   */
  get<T>(category: string, key: string): T | undefined {
    const categoryData = this.data[category]
    if (!categoryData) return undefined

    // Support nested paths like "codeEditor.enabled"
    if (key.includes('.')) {
      const keyPath = key.split('.')
      let current: unknown = categoryData

      for (const segment of keyPath) {
        if (current && typeof current === 'object') {
          current = (current as Record<string, unknown>)[segment]
        } else {
          return undefined
        }
      }
      return current as T
    }

    return (categoryData as Record<string, unknown>)[key] as T
  }

  /**
   * Get entire category data
   * @param category - Category name
   */
  getCategory<T>(category: string): T | undefined {
    return this.data[category] as T | undefined
  }

  /**
   * Check if a category exists
   */
  hasCategory(category: string): boolean {
    return category in this.data
  }

  /**
   * Get all available categories
   */
  getCategories(): string[] {
    return Object.keys(this.data)
  }
}
