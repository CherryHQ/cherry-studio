/**
 * Persist cache schema defining allowed keys and their value types
 * This ensures type safety and prevents key conflicts
 */
export interface PersistCacheSchema {
  'example-1': string
  'example-2': number
  'example-3': boolean
  'example-4': { a: string; b: number; c: boolean }
}

export const DefaultPersistCache: PersistCacheSchema = {
  'example-1': 'example-1',
  'example-2': 1,
  'example-3': true,
  'example-4': { a: 'example-4', b: 4, c: false }
}

/**
 * Type-safe persist cache key
 */
export type PersistCacheKey = keyof PersistCacheSchema
