/**
 * Redux state reader for accessing Redux Persist data
 * Production data is exported as one JSON file per Redux category so the
 * renderer never has to retain and IPC-clone the complete parsed state.
 */

import fs from 'fs'
import path from 'path'

export class ReduxStateReader {
  private readonly data: Record<string, unknown> | null
  private readonly exportPath: string | null
  private cachedCategory: { name: string; value: unknown } | null = null

  constructor(source: Record<string, unknown> | string) {
    this.data = typeof source === 'string' ? null : source
    this.exportPath = typeof source === 'string' ? source : null
  }

  private readCategory<T>(category: string): T | undefined {
    if (this.data) return this.data[category] as T | undefined
    if (!this.exportPath) return undefined
    if (this.cachedCategory?.name === category) return this.cachedCategory.value as T | undefined

    let value: T | undefined
    try {
      const rawValue = fs.readFileSync(path.join(this.exportPath, `${category}.json`), 'utf-8')
      try {
        value = JSON.parse(rawValue) as T
      } catch (error) {
        if (error instanceof SyntaxError) value = rawValue as T
        else throw error
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    this.cachedCategory = { name: category, value }
    return value
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
    const categoryData = this.readCategory<unknown>(category)
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
    return this.readCategory<T>(category)
  }
}
