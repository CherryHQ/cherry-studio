import type { LocalStorageRecord } from '@shared/data/migration/v2/types'

export class LocalStorageReader {
  private data: Map<string, unknown>

  constructor(records: LocalStorageRecord[]) {
    this.data = new Map(records.map((r) => [r.key, r.value]))
  }

  get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined
  }

  has(key: string): boolean {
    return this.data.has(key)
  }

  keys(): string[] {
    return [...this.data.keys()]
  }

  getByPrefix(prefix: string): LocalStorageRecord[] {
    const results: LocalStorageRecord[] = []
    for (const [key, value] of this.data) {
      if (key.startsWith(prefix)) {
        results.push({ key, value })
      }
    }
    return results
  }

  getByPattern(pattern: string): LocalStorageRecord[] {
    const regex = this.globToRegex(pattern)
    const results: LocalStorageRecord[] = []
    for (const [key, value] of this.data) {
      if (regex.test(key)) {
        results.push({ key, value })
      }
    }
    return results
  }

  get size(): number {
    return this.data.size
  }

  private globToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    const regexStr = escaped.replace(/\*/g, '.*').replace(/\?/g, '.')
    return new RegExp(`^${regexStr}$`)
  }
}
