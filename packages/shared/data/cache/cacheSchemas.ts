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

  // UI State
  'ui.activeTabId': string
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

  // UI State
  'ui.activeTabId': ''
}

/**
 * Use shared cache schema for renderer hook
 */
export type UseSharedCacheSchema = {
  'example-key': string
}

export const DefaultUseSharedCache: UseSharedCacheSchema = {
  'example-key': 'example default value'
}

/**
 * Persist cache schema defining allowed keys and their value types
 * This ensures type safety and prevents key conflicts
 */
export type RendererPersistCacheSchema = {
  'example-key': string
}

export const DefaultRendererPersistCache: RendererPersistCacheSchema = {
  'example-key': 'example default value'
}

/**
 * Type-safe cache key
 */
export type RendererPersistCacheKey = keyof RendererPersistCacheSchema
export type UseCacheKey = keyof UseCacheSchema
export type UseSharedCacheKey = keyof UseSharedCacheSchema
