import type * as CacheValueTypes from './cacheValueTypes'

/**
 * Cache Schema Definitions
 *
 * ## Key Naming Convention
 *
 * All cache keys MUST follow the format: `namespace.sub.key_name`
 *
 * Rules:
 * - At least 2 segments separated by dots (.)
 * - Each segment uses lowercase letters, numbers, and underscores only
 * - Pattern: /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/
 *
 * Examples:
 * - 'app.user.avatar' (valid)
 * - 'chat.multi_select_mode' (valid)
 * - 'minapp.opened_keep_alive' (valid)
 * - 'userAvatar' (invalid - missing dot separator)
 * - 'App.user' (invalid - uppercase not allowed)
 *
 * This convention is enforced by ESLint rule: data-schema-key/valid-key
 */

/**
 * Use cache schema for renderer hook
 */

export type UseCacheSchema = {
  // App state
  'app.dist.update_state': CacheValueTypes.CacheAppUpdateState
  'app.user.avatar': string

  'app.path.files': string
  'app.path.resources': string

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
}

export const DefaultUseCache: UseCacheSchema = {
  // App state
  'app.dist.update_state': {
    info: null,
    checking: false,
    downloading: false,
    downloaded: false,
    downloadProgress: 0,
    available: false,
    ignore: false
  },
  'app.user.avatar': '',
  'app.path.files': '',
  'app.path.resources': '',
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
  'topic.newly_renamed': []
}

/**
 * Use shared cache schema for renderer hook
 */
export type UseSharedCacheSchema = {
  'example_scope.example_key': string
}

export const DefaultUseSharedCache: UseSharedCacheSchema = {
  'example_scope.example_key': 'example default value'
}

/**
 * Persist cache schema defining allowed keys and their value types
 * This ensures type safety and prevents key conflicts
 */
export type RendererPersistCacheSchema = {
  'example_scope.example_key': string
}

export const DefaultRendererPersistCache: RendererPersistCacheSchema = {
  'example_scope.example_key': 'example default value'
}

/**
 * Type-safe cache key
 */
export type RendererPersistCacheKey = keyof RendererPersistCacheSchema
export type UseCacheKey = keyof UseCacheSchema
export type UseSharedCacheKey = keyof UseSharedCacheSchema
