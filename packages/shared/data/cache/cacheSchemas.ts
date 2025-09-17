import type * as CacheValueTypes from './cacheValueTypes'

/**
 * Use cache schema for renderer hook
 */

export type UseCacheSchema = {
  // App state
  'app.dist.update_state': CacheValueTypes.CacheAppUpdateState
  'app.user.avatar': string

  // Chat context
  'chat.multi_select_mode': boolean
  'chat.selected_message_ids': string[]
  'chat.generating': boolean
  'chat.websearch.searching': boolean
  'chat.websearch.active_searches': CacheValueTypes.CacheActiveSearches

  // Minapp management
  'minapp.opened_keep_alive': CacheValueTypes.CacheMinAppType[]
  'minapp.current_id': string
  'minapp.show': boolean
  'minapp.opened_oneoff': CacheValueTypes.CacheMinAppType | null

  // Topic management
  'topic.active': CacheValueTypes.CacheTopic | null
  'topic.renaming': string[]
  'topic.newly_renamed': string[]

  // Test keys (for dataRefactorTest window)
  // TODO: remove after testing
  'test-hook-memory-1': string
  'test-ttl-cache': string
  'test-protected-cache': string
  'test-deep-equal': { nested: { count: number }; tags: string[] }
  'test-performance': number
  'test-multi-hook': string
  'concurrent-test-1': number
  'concurrent-test-2': number
  'large-data-test': Record<string, any>
  'test-number-cache': number
  'test-object-cache': { name: string; count: number; active: boolean }
}

export const DefaultUseCache: UseCacheSchema = {
  // App state
  'app.dist.update_state': {
    info: null,
    checking: false,
    downloading: false,
    downloaded: false,
    downloadProgress: 0,
    available: false
  },
  'app.user.avatar': '',

  // Chat context
  'chat.multi_select_mode': false,
  'chat.selected_message_ids': [],
  'chat.generating': false,
  'chat.websearch.searching': false,
  'chat.websearch.active_searches': {},

  // Minapp management
  'minapp.opened_keep_alive': [],
  'minapp.current_id': '',
  'minapp.show': false,
  'minapp.opened_oneoff': null,

  // Topic management
  'topic.active': null,
  'topic.renaming': [],
  'topic.newly_renamed': [],

  // Test keys (for dataRefactorTest window)
  // TODO: remove after testing
  'test-hook-memory-1': 'default-memory-value',
  'test-ttl-cache': 'test-ttl-cache',
  'test-protected-cache': 'protected-value',
  'test-deep-equal': { nested: { count: 0 }, tags: ['initial'] },
  'test-performance': 0,
  'test-multi-hook': 'hook-1-default',
  'concurrent-test-1': 0,
  'concurrent-test-2': 0,
  'large-data-test': {},
  'test-number-cache': 42,
  'test-object-cache': { name: 'test', count: 0, active: true }
}

/**
 * Use shared cache schema for renderer hook
 */
export type UseSharedCacheSchema = {
  'example-key': string

  // Test keys (for dataRefactorTest window)
  // TODO: remove after testing
  'test-hook-shared-1': string
  'test-multi-hook': string
  'concurrent-shared': number
}

export const DefaultUseSharedCache: UseSharedCacheSchema = {
  'example-key': 'example default value',

  // Test keys (for dataRefactorTest window)
  // TODO: remove after testing
  'concurrent-shared': 0,
  'test-hook-shared-1': 'default-shared-value',
  'test-multi-hook': 'hook-3-shared'
}

/**
 * Persist cache schema defining allowed keys and their value types
 * This ensures type safety and prevents key conflicts
 */
export type RendererPersistCacheSchema = {
  'example-key': string

  // Test keys (for dataRefactorTest window)
  // TODO: remove after testing
  'example-1': string
  'example-2': string
  'example-3': string
  'example-4': string
}

export const DefaultRendererPersistCache: RendererPersistCacheSchema = {
  'example-key': 'example default value',

  // Test keys (for dataRefactorTest window)
  // TODO: remove after testing
  'example-1': 'example default value',
  'example-2': 'example default value',
  'example-3': 'example default value',
  'example-4': 'example default value'
}

/**
 * Type-safe cache key
 */
export type RendererPersistCacheKey = keyof RendererPersistCacheSchema
export type UseCacheKey = keyof UseCacheSchema
export type UseSharedCacheKey = keyof UseSharedCacheSchema
