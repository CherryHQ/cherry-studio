import type * as CacheValueTypes from './cacheValueTypes'

/**
 * Cache Schema Definitions
 *
 * ## Key Naming Convention
 *
 * All cache keys (fixed and template) MUST follow the format: `namespace.sub.key_name`
 *
 * Rules:
 * - At least 2 segments separated by dots (.)
 * - Each segment uses lowercase letters, numbers, and underscores only
 * - Pattern: /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/
 * - Template placeholders `${xxx}` are treated as literal string segments
 *
 * Examples:
 * - 'app.user.avatar' (valid)
 * - 'chat.multi_select_mode' (valid)
 * - 'scroll.position.${topicId}' (valid template key)
 * - 'userAvatar' (invalid - missing dot separator)
 * - 'App.user' (invalid - uppercase not allowed)
 * - 'scroll.position:${id}' (invalid - colon not allowed)
 *
 * ## Template Key Support
 *
 * Template keys allow type-safe dynamic keys using template literal syntax.
 * Define in schema with `${variable}` placeholder, use with actual values.
 * Template keys follow the same dot-separated pattern as fixed keys.
 *
 * Examples:
 * - Schema: `'scroll.position.${topicId}': number`
 * - Usage: `useCache('scroll.position.topic123')` -> infers `number` type
 *
 * Multiple placeholders are supported:
 * - Schema: `'entity.cache.${type}_${id}': CacheData`
 * - Usage: `useCache('entity.cache.user_456')` -> infers `CacheData` type
 *
 * This convention is enforced by ESLint rule: data-schema-key/valid-key
 */

// ============================================================================
// Template Key Type Utilities
// ============================================================================

/**
 * Detects whether a key string contains template placeholder syntax.
 *
 * Template keys use `${variable}` syntax to define dynamic segments.
 * This type returns `true` if the key contains at least one `${...}` placeholder.
 *
 * @template K - The key string to check
 * @returns `true` if K contains `${...}`, `false` otherwise
 *
 * @example
 * ```typescript
 * type Test1 = IsTemplateKey<'scroll.position.${id}'>     // true
 * type Test2 = IsTemplateKey<'entity.cache.${a}_${b}'>    // true
 * type Test3 = IsTemplateKey<'app.user.avatar'>           // false
 * ```
 */
export type IsTemplateKey<K extends string> = K extends `${string}\${${string}}${string}` ? true : false

/**
 * Expands a template key pattern into a matching literal type.
 *
 * Replaces each `${variable}` placeholder with `string`, allowing
 * TypeScript to match concrete keys against the template pattern.
 * Recursively processes multiple placeholders.
 *
 * @template T - The template key pattern to expand
 * @returns A template literal type that matches all valid concrete keys
 *
 * @example
 * ```typescript
 * type Test1 = ExpandTemplateKey<'scroll.position.${id}'>
 * // Result: `scroll.position.${string}` (matches 'scroll.position.123', etc.)
 *
 * type Test2 = ExpandTemplateKey<'entity.cache.${type}_${id}'>
 * // Result: `entity.cache.${string}_${string}` (matches 'entity.cache.user_123', etc.)
 *
 * type Test3 = ExpandTemplateKey<'app.user.avatar'>
 * // Result: 'app.user.avatar' (unchanged for non-template keys)
 * ```
 */
export type ExpandTemplateKey<T extends string> = T extends `${infer Prefix}\${${string}}${infer Suffix}`
  ? `${Prefix}${string}${ExpandTemplateKey<Suffix>}`
  : T

/**
 * Processes a cache key, expanding template patterns if present.
 *
 * For template keys (containing `${...}`), returns the expanded pattern.
 * For fixed keys, returns the key unchanged.
 *
 * @template K - The key to process
 * @returns The processed key type (expanded if template, unchanged if fixed)
 *
 * @example
 * ```typescript
 * type Test1 = ProcessKey<'scroll.position.${id}'>  // `scroll.position.${string}`
 * type Test2 = ProcessKey<'app.user.avatar'>        // 'app.user.avatar'
 * ```
 */
export type ProcessKey<K extends string> = IsTemplateKey<K> extends true ? ExpandTemplateKey<K> : K

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
  'chat.active_view': 'topic' | 'session'

  // Minapp management
  'minapp.opened_keep_alive': CacheValueTypes.CacheMinAppType[]
  'minapp.current_id': string
  'minapp.show': boolean
  'minapp.opened_oneoff': CacheValueTypes.CacheMinAppType | null

  // Topic management
  'topic.active': CacheValueTypes.CacheTopic | null
  'topic.renaming': string[]
  'topic.newly_renamed': string[]

  // Agent management
  'agent.active_id': string | null
  'agent.session.active_id_map': Record<string, string | null>
  'agent.session.waiting_id_map': Record<string, boolean>

  // Template key examples (for testing and demonstration)
  'scroll.position.${topicId}': number
  'entity.cache.${type}_${id}': { loaded: boolean; data: unknown }

  // ============================================================================
  // Message Streaming Cache (Temporary)
  // ============================================================================
  // TODO [v2]: Replace `any` with proper types after newMessage.ts types are
  // migrated to packages/shared/data/types/message.ts
  // Current types:
  // - StreamingTask: defined locally in StreamingService.ts
  // - Message: src/renderer/src/types/newMessage.ts (renderer format, not shared/Message)
  // - MessageBlock: src/renderer/src/types/newMessage.ts
  'message.streaming.task.${messageId}': any // StreamingTask
  'message.streaming.topic_tasks.${topicId}': string[]
  'message.streaming.content.${messageId}': any // Message (renderer format)
  'message.streaming.block.${blockId}': any // MessageBlock
  'message.streaming.siblings_counter.${topicId}': number
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
  'chat.active_view': 'topic',

  // Minapp management
  'minapp.opened_keep_alive': [],
  'minapp.current_id': '',
  'minapp.show': false,
  'minapp.opened_oneoff': null,

  // Topic management
  'topic.active': null,
  'topic.renaming': [],
  'topic.newly_renamed': [],

  // Agent management
  'agent.active_id': null,
  'agent.session.active_id_map': {},
  'agent.session.waiting_id_map': {},

  // Template key examples (for testing and demonstration)
  'scroll.position.${topicId}': 0,
  'entity.cache.${type}_${id}': { loaded: false, data: null },

  // Message Streaming Cache
  'message.streaming.task.${messageId}': null,
  'message.streaming.topic_tasks.${topicId}': [],
  'message.streaming.content.${messageId}': null,
  'message.streaming.block.${blockId}': null,
  'message.streaming.siblings_counter.${topicId}': 0
}

/**
 * Use shared cache schema for renderer hook
 */
export type SharedCacheSchema = {
  'example_scope.example_key': string
}

export const DefaultSharedCache: SharedCacheSchema = {
  'example_scope.example_key': 'example default value'
}

/**
 * Persist cache schema defining allowed keys and their value types
 * This ensures type safety and prevents key conflicts
 */
export type RendererPersistCacheSchema = {
  'ui.tab.pinned_tabs': CacheValueTypes.Tab[]
}

export const DefaultRendererPersistCache: RendererPersistCacheSchema = {
  'ui.tab.pinned_tabs': []
}

// ============================================================================
// Cache Key Types
// ============================================================================

/**
 * Key type for renderer persist cache (fixed keys only)
 */
export type RendererPersistCacheKey = keyof RendererPersistCacheSchema

/**
 * Key type for shared cache (fixed keys only)
 */
export type SharedCacheKey = keyof SharedCacheSchema

/**
 * Key type for memory cache (supports both fixed and template keys).
 *
 * This type expands all schema keys using ProcessKey, which:
 * - Keeps fixed keys unchanged (e.g., 'app.user.avatar')
 * - Expands template keys to match patterns (e.g., 'scroll.position.${id}' -> `scroll.position.${string}`)
 *
 * The resulting union type allows TypeScript to accept any concrete key
 * that matches either a fixed key or an expanded template pattern.
 *
 * @example
 * ```typescript
 * // Given schema:
 * // 'app.user.avatar': string
 * // 'scroll.position.${topicId}': number
 *
 * // UseCacheKey becomes: 'app.user.avatar' | `scroll.position.${string}`
 *
 * // Valid keys:
 * const k1: UseCacheKey = 'app.user.avatar'       // fixed key
 * const k2: UseCacheKey = 'scroll.position.123'   // matches template
 * const k3: UseCacheKey = 'scroll.position.abc'   // matches template
 *
 * // Invalid keys:
 * const k4: UseCacheKey = 'unknown.key'           // error: not in schema
 * ```
 */
export type UseCacheKey = {
  [K in keyof UseCacheSchema]: ProcessKey<K & string>
}[keyof UseCacheSchema]

// ============================================================================
// UseCache Specialized Types
// ============================================================================

/**
 * Infers the value type for a given cache key from UseCacheSchema.
 *
 * Works with both fixed keys and template keys:
 * - For fixed keys, returns the exact value type from schema
 * - For template keys, matches the key against expanded patterns and returns the value type
 *
 * If the key doesn't match any schema entry, returns `never`.
 *
 * @template K - The cache key to infer value type for
 * @returns The value type associated with the key, or `never` if not found
 *
 * @example
 * ```typescript
 * // Given schema:
 * // 'app.user.avatar': string
 * // 'scroll.position.${topicId}': number
 *
 * type T1 = InferUseCacheValue<'app.user.avatar'>       // string
 * type T2 = InferUseCacheValue<'scroll.position.123'>   // number
 * type T3 = InferUseCacheValue<'scroll.position.abc'>   // number
 * type T4 = InferUseCacheValue<'unknown.key'>           // never
 * ```
 */
export type InferUseCacheValue<K extends string> = {
  [S in keyof UseCacheSchema]: K extends ProcessKey<S & string> ? UseCacheSchema[S] : never
}[keyof UseCacheSchema]

/**
 * Type guard for casual cache keys that blocks schema-defined keys.
 *
 * Used to ensure casual API methods (getCasual, setCasual, etc.) cannot
 * be called with keys that are defined in the schema (including template patterns).
 * This enforces proper API usage: use type-safe methods for schema keys,
 * use casual methods only for truly dynamic/unknown keys.
 *
 * @template K - The key to check
 * @returns `K` if the key doesn't match any schema pattern, `never` if it does
 *
 * @example
 * ```typescript
 * // Given schema:
 * // 'app.user.avatar': string
 * // 'scroll.position.${topicId}': number
 *
 * // These cause compile-time errors (key matches schema):
 * getCasual('app.user.avatar')        // Error: never
 * getCasual('scroll.position.123')    // Error: never (matches template)
 *
 * // These are allowed (key doesn't match any schema pattern):
 * getCasual('my.custom.key')          // OK
 * getCasual('other.dynamic.key')      // OK
 * ```
 */
export type UseCacheCasualKey<K extends string> = K extends UseCacheKey ? never : K
