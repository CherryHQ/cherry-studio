import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import type {
  InferSharedCacheValue,
  InferUseCacheValue,
  RendererPersistCacheKey,
  RendererPersistCacheSchema,
  SharedCacheKey,
  UseCacheKey,
  UseCacheSchema
} from '@shared/data/cache/cacheSchemas'
import { DefaultSharedCache, DefaultUseCache } from '@shared/data/cache/cacheSchemas'
import { findMatchingSharedCacheSchemaKey, isTemplateKey, templateToRegex } from '@shared/data/cache/templateKey'
import { isPlainObject } from 'es-toolkit/compat'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector'

const logger = loggerService.withContext('useCache')

// ============================================================================
// Functional Updater Types
// ============================================================================

/**
 * Shallow-readonly view of a cache value, used for the `prev` argument of a
 * functional updater. Containers (objects/arrays) become `Readonly<T>` so the
 * most common footgun — mutating `prev` in place and returning it — fails to
 * compile; primitives pass through unchanged so `prev => !prev` / `prev => prev + 1`
 * still work.
 *
 * Shallow only: nested mutation (e.g. `prev.items[0].x = ...`) is NOT caught by
 * the type — keep updaters pure (see {@link CacheSetStateAction}).
 */
type ReadonlyValue<T> = T extends object ? Readonly<T> : T

/**
 * Setter input for cache hooks, mirroring React's `SetStateAction<T>`: either a
 * concrete value or an updater `(prev) => next`.
 *
 * The updater is resolved against the **latest stored value** at write time (not
 * the render-time snapshot), which is what makes read-modify-write safe across an
 * `await`. It MUST be pure and return a new value: mutating `prev` in place and
 * returning the same reference makes `CacheService` short-circuit on
 * `isEqual(stored, value)` and silently skip the subscriber notification.
 *
 * "Pure" also means no side effects inside the updater: do not smuggle a derived
 * result out (e.g. by writing to an enclosing-scope variable) to drive post-write
 * work, and do not assume how many times or when it runs. To react to *what
 * changed* — e.g. dispose resources for items that were removed — derive it from
 * the value transition in a `useEffect` that watches the value, not from inside
 * the updater.
 *
 * Caveat (same as React's `SetStateAction`): for keys whose value type is itself
 * a function (only the `any`-typed keys in practice), a function argument is
 * always treated as an updater, never stored verbatim.
 */
type CacheSetStateAction<T> = T | ((prev: ReadonlyValue<T>) => T)

// ============================================================================
// Template Matching Utilities
// ============================================================================

/**
 * Finds the schema key that matches a given concrete key.
 *
 * First checks for exact match (fixed keys), then checks template patterns.
 * This is used to look up default values for template keys.
 *
 * @param key - The concrete key to find a match for
 * @returns The matching schema key, or undefined if no match found
 *
 * @example
 * ```typescript
 * // Given schema has 'app.user.avatar' and 'scroll.position.${id}'
 *
 * findMatchingUseCacheSchemaKey('app.user.avatar')       // 'app.user.avatar'
 * findMatchingUseCacheSchemaKey('scroll.position.123')   // 'scroll.position.${id}'
 * findMatchingUseCacheSchemaKey('unknown.key')           // undefined
 * ```
 */
function findMatchingUseCacheSchemaKey(key: string): keyof UseCacheSchema | undefined {
  // First, check for exact match (fixed keys)
  if (key in DefaultUseCache) {
    return key as keyof UseCacheSchema
  }

  // Then, check template patterns
  const schemaKeys = Object.keys(DefaultUseCache) as Array<keyof UseCacheSchema>
  for (const schemaKey of schemaKeys) {
    if (isTemplateKey(schemaKey as string)) {
      const regex = templateToRegex(schemaKey as string)
      if (regex.test(key)) {
        return schemaKey
      }
    }
  }

  return undefined
}

/**
 * Gets the default value for a cache key from the schema.
 *
 * Works with both fixed keys (direct lookup) and concrete keys that
 * match template patterns (finds template, returns its default).
 *
 * @param key - The cache key (fixed or concrete template instance)
 * @returns The default value from schema, or undefined if not found
 *
 * @example
 * ```typescript
 * // Given schema:
 * // 'app.user.avatar': '' (default)
 * // 'scroll.position.${id}': 0 (default)
 *
 * getUseCacheDefaultValue('app.user.avatar')       // ''
 * getUseCacheDefaultValue('scroll.position.123')   // 0
 * getUseCacheDefaultValue('unknown.key')           // undefined
 * ```
 */
function getUseCacheDefaultValue<K extends UseCacheKey>(key: K): InferUseCacheValue<K> | undefined {
  const schemaKey = findMatchingUseCacheSchemaKey(key)
  if (schemaKey) {
    return DefaultUseCache[schemaKey] as InferUseCacheValue<K>
  }
  return undefined
}

/**
 * Gets the default value for a shared cache key from the schema.
 *
 * Works with both fixed keys (direct lookup) and concrete keys that
 * match template patterns (finds template, returns its default).
 *
 * Note: template default values are shared across all instances — e.g., all
 * `web_search.provider.last_used_key.*` keys fall back to the single default
 * `''`. This mirrors getUseCacheDefaultValue semantics.
 */
function getSharedCacheDefaultValue<K extends SharedCacheKey>(key: K): InferSharedCacheValue<K> | undefined {
  const schemaKey = findMatchingSharedCacheSchemaKey(key)
  if (schemaKey) {
    return DefaultSharedCache[schemaKey] as InferSharedCacheValue<K>
  }
  return undefined
}

/**
 * React hook for component-level memory cache
 *
 * Use this for data that needs to be shared between components in the same window.
 * Data is lost when the app restarts.
 *
 * Supports both fixed keys and template keys:
 * - Fixed keys: `useCache('app.user.avatar')`
 * - Template keys: `useCache('scroll.position.topic123')` (matches schema `'scroll.position.${id}'`)
 *
 * Template keys follow the same dot-separated pattern as fixed keys.
 * When ${xxx} is treated as a literal string, the key matches: xxx.yyy.zzz_www
 *
 * @template K - The cache key type (inferred from UseCacheKey)
 * @param key - Cache key from the predefined schema (fixed or matching template pattern)
 * @param initValue - Initial value (optional, uses schema default if not provided)
 * @returns [value, setValue] - Similar to useState but shared across components
 *
 * @example
 * ```typescript
 * // Fixed key usage
 * const [avatar, setAvatar] = useCache('app.user.avatar')
 *
 * // Template key usage (schema: 'scroll.position.${id}': number)
 * const [scrollPos, setScrollPos] = useCache('scroll.position.topic123')
 * // TypeScript infers scrollPos as number
 *
 * // With custom initial value
 * const [generating, setGenerating] = useCache('chat.web_search.searching', true)
 *
 * // Update the value
 * setAvatar('new-avatar-url')
 *
 * // Functional update — resolved against the latest stored value (safe across awaits)
 * setOpened((prev) => prev.filter((item) => item.id !== id))
 * ```
 *
 * @remarks
 * The setter accepts a value or an updater `(prev) => next`, like React's
 * `useState`. The updater MUST be pure: it runs against the latest stored value
 * and must return a new value — mutating `prev` in place and returning the same
 * reference is short-circuited by `isEqual` and silently skips the re-render. It
 * must also be side-effect-free: don't smuggle a derived value out of it (e.g. into
 * an outer variable) to drive post-write work, and don't rely on how often or when
 * it runs. To react to *what changed*, derive it in a `useEffect` that watches the
 * value instead.
 */
export function useCache<K extends UseCacheKey>(
  key: K,
  initValue?: InferUseCacheValue<K>
): [InferUseCacheValue<K>, (value: CacheSetStateAction<InferUseCacheValue<K>>) => void] {
  // Get the default value for this key (works with both fixed and template keys)
  const defaultValue = getUseCacheDefaultValue(key)

  /**
   * Subscribe to cache changes using React's useSyncExternalStore
   * This ensures the component re-renders when the cache value changes
   */
  const value = useSyncExternalStore(
    useCallback((callback) => cacheService.subscribe(key, callback), [key]),
    useCallback(() => cacheService.get(key), [key]),
    useCallback(() => cacheService.get(key), [key]) // SSR snapshot
  )

  /**
   * Initialize cache with default value if it doesn't exist
   * Priority: existing cache value > custom initValue > schema default (via template matching)
   */
  useEffect(() => {
    if (cacheService.has(key)) {
      return
    }

    if (initValue !== undefined) {
      cacheService.set(key, initValue)
    } else if (defaultValue !== undefined) {
      cacheService.set(key, defaultValue)
    }
  }, [key, initValue, defaultValue])

  /**
   * Register this hook as actively using the cache key
   * This prevents the cache service from deleting the key while the hook is active
   */
  useEffect(() => {
    cacheService.registerHook(key)
    return () => cacheService.unregisterHook(key)
  }, [key])

  /**
   * Warn developers when using TTL with hooks
   * TTL can cause values to expire between renders, leading to unstable behavior
   */
  useEffect(() => {
    if (cacheService.hasTTL(key)) {
      logger.warn(
        `useCache hook for key "${key}" is using a cache with TTL. This may cause unstable behavior as the value can expire between renders.`
      )
    }
  }, [key])

  /**
   * Memoized setter function for updating the cache value.
   * Accepts a concrete value or a functional updater `(prev) => next`. The
   * updater is resolved against the latest stored value via the same default
   * fallback chain as the hook return (`get ?? initValue ?? schema default`),
   * so it stays correct across an `await`.
   * @param newValue - New value, or an updater computing it from the latest value
   */
  const setValue = useCallback(
    (newValue: CacheSetStateAction<InferUseCacheValue<K>>) => {
      if (typeof newValue === 'function') {
        const prev = (cacheService.get(key) ?? initValue ?? defaultValue) as ReadonlyValue<InferUseCacheValue<K>>
        cacheService.set(key, newValue(prev))
      } else {
        cacheService.set(key, newValue)
      }
    },
    [key, initValue, defaultValue]
  )

  return [value ?? initValue ?? defaultValue!, setValue]
}

/**
 * React hook for cross-window shared cache
 *
 * Use this for data that needs to be shared between all app windows.
 * Data is lost when the app restarts.
 *
 * Supports both fixed keys and template keys (aligned with useCache):
 * - Fixed keys: `useSharedCache('chat.web_search.active_searches')`
 * - Template keys: `useSharedCache('web_search.provider.last_used_key.google')`
 *   matches schema entry `'web_search.provider.last_used_key.${providerId}'`
 *
 * Template-instance defaults are shared across all matching instances (inherited
 * from useCache semantics) — the schema default is written to cache on hook mount.
 *
 * @param key - Cache key from the predefined schema (fixed or matching template)
 * @param initValue - Initial value (optional, uses schema default if not provided)
 * @returns [value, setValue] - Similar to useState but shared across all windows
 *
 * @example
 * ```typescript
 * // Fixed key
 * const [active, setActive] = useSharedCache('chat.web_search.active_searches')
 *
 * // Template key (schema: 'web_search.provider.last_used_key.${providerId}')
 * const [lastKey, setLastKey] = useSharedCache('web_search.provider.last_used_key.google')
 *
 * // Changes automatically sync to all open windows
 * setLastKey('api-key-1')
 *
 * // Functional update — resolved against this window's latest local value
 * setActive((prev) => ({ ...prev, [id]: state }))
 * ```
 *
 * @remarks
 * The setter accepts a value or an updater `(prev) => next`. The updater resolves
 * against THIS window's latest local value — it fixes read-modify-write races
 * within a window across awaits, but does NOT guarantee cross-window atomicity
 * (concurrent writes from another window can still be last-write-wins). Keep the
 * updater pure and return a new value (see `useCache`).
 */
export function useSharedCache<K extends SharedCacheKey>(
  key: K,
  initValue?: InferSharedCacheValue<K>
): [InferSharedCacheValue<K>, (value: CacheSetStateAction<InferSharedCacheValue<K>>) => void] {
  /**
   * Subscribe to shared cache changes using React's useSyncExternalStore.
   * This ensures the component re-renders when the shared cache value changes.
   * The snapshot is the pure physical reader (getSharedSnapshot): an
   * external-store getSnapshot must not mutate the store or flip with time —
   * the TTL-aware, lazily-evicting getShared stays reserved for imperative
   * reads and the setter's functional updater.
   */
  const value = useSyncExternalStore(
    useCallback((callback) => cacheService.subscribe(key, callback), [key]),
    useCallback(() => cacheService.getSharedSnapshot(key), [key]),
    useCallback(() => cacheService.getSharedSnapshot(key), [key]) // SSR snapshot
  )

  /**
   * Initialize shared cache with default value if it doesn't exist.
   * Priority: existing shared cache value > custom initValue > schema default.
   *
   * Template-instance defaults fall through getSharedCacheDefaultValue, which
   * resolves the concrete key back to its schema template and returns the
   * shared default (e.g. all 'web_search.provider.last_used_key.*' instances
   * share the single default '').
   */
  useEffect(() => {
    if (cacheService.hasShared(key)) {
      return
    }

    if (initValue === undefined) {
      const defaultValue = getSharedCacheDefaultValue(key)
      if (defaultValue !== undefined) {
        cacheService.setShared(key, defaultValue)
      }
    } else {
      cacheService.setShared(key, initValue)
    }
  }, [key, initValue])

  /**
   * Register this hook as actively using the shared cache key
   * This prevents the cache service from deleting the key while the hook is active
   */
  useEffect(() => {
    cacheService.registerHook(key)
    return () => cacheService.unregisterHook(key)
  }, [key])

  /**
   * Warn developers when using TTL with shared cache hooks
   * TTL can cause values to expire between renders, leading to unstable behavior
   */
  useEffect(() => {
    if (cacheService.hasSharedTTL(key)) {
      logger.warn(
        `useSharedCache hook for key "${key}" is using a cache with TTL. This may cause unstable behavior as the value can expire between renders.`
      )
    }
  }, [key])

  /**
   * Memoized setter function for updating the shared cache value.
   * Changes will be synchronized across all renderer windows. Accepts a concrete
   * value or a functional updater `(prev) => next` resolved against this window's
   * latest local value (same default fallback chain as the hook return).
   * @param newValue - New value, or an updater computing it from the latest value
   */
  const setValue = useCallback(
    (newValue: CacheSetStateAction<InferSharedCacheValue<K>>) => {
      if (typeof newValue === 'function') {
        const prev = (cacheService.getShared(key) ?? initValue ?? getSharedCacheDefaultValue(key)) as ReadonlyValue<
          InferSharedCacheValue<K>
        >
        cacheService.setShared(key, newValue(prev))
      } else {
        cacheService.setShared(key, newValue)
      }
    },
    [key, initValue]
  )

  return [value ?? initValue ?? (getSharedCacheDefaultValue(key) as InferSharedCacheValue<K>), setValue]
}

/**
 * React hook for READ-ONLY observation of a cross-window shared cache key.
 *
 * Use this whenever the window only displays a value that another process owns
 * (typically a main service publishing via `setShared`). Unlike `useSharedCache`,
 * mounting it has zero side effects on the cache:
 * - never writes the schema default back (a writable hook mounting during the
 *   "owner hasn't published yet" race materializes the default, broadcasts it
 *   to every window, and can clobber the owner's real value)
 * - never pins the key against deletion (no `registerHook`)
 * - returns no setter and accepts no `initValue`/TTL
 *
 * Snapshot semantics: reads the local physical mirror via `getSharedSnapshot`
 * (event-driven, no TTL evaluation, no store mutation). Returns `undefined`
 * when the key is physically absent or after the owner's deletion tombstone
 * arrives; an expired entry may briefly retain its old value until Main's
 * lazy cleanup / GC broadcasts the tombstone (eventual consistency — see
 * cache-overview.md).
 *
 * Fallbacks are the consumer's job: apply `?? fallback` with a REFERENCE-STABLE
 * default — a module-level const for objects/arrays, or an unconditionally
 * evaluated `useMemo` when the default depends on props. Never place a hook
 * call on the right side of `??` (conditional hook call).
 *
 * @param key - Cache key from the predefined schema (fixed or matching template)
 * @returns The observed value, or undefined when physically absent
 *
 * @example
 * ```typescript
 * const EMPTY_PROGRESS: JobProgress = { progress: 0 }
 *
 * function useJobProgress(jobId: string): JobProgress {
 *   return useSharedCacheValue(`jobs.progress.${jobId}` as const) ?? EMPTY_PROGRESS
 * }
 * ```
 */
export function useSharedCacheValue<K extends SharedCacheKey>(key: K): InferSharedCacheValue<K> | undefined {
  return useSyncExternalStore(
    useCallback((callback) => cacheService.subscribe(key, callback), [key]),
    useCallback(() => cacheService.getSharedSnapshot(key), [key]),
    useCallback(() => cacheService.getSharedSnapshot(key), [key]) // SSR snapshot
  )
}

// ============================================================================
// Multi-key Selector (Shared)
// ============================================================================

/**
 * Values tuple delivered to a `useSharedCacheSelector` selector: same order as
 * `keys`, each entry typed precisely from the schema, `undefined` when the key
 * is physically absent. Not exported: inline selectors get it inferred, and
 * the migrated out-of-line selectors type their parameters directly.
 */
type SharedCacheValues<Keys extends readonly SharedCacheKey[]> = {
  readonly [Index in keyof Keys]: Keys[Index] extends SharedCacheKey
    ? InferSharedCacheValue<Keys[Index]> | undefined
    : never
}

/**
 * Default selection comparator for `useSharedCacheSelector`. File-private:
 * the hook applies it by default, so no consumer needs to import it — its
 * contract is locked through the hook's behavior tests.
 *
 * Promise: `Object.is` on the selections themselves, plus one level of
 * item-wise `Object.is` for arrays and plain objects (own enumerable string
 * keys). Anything else — `Map`, `Set`, class instances, nested structural
 * equality — is deliberately NOT handled and compares unequal: pass an
 * explicit domain comparator instead.
 */
function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => Object.is(item, b[index]))
  }

  if (!isPlainObject(a) || !isPlainObject(b)) return false

  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  return keysA.every(
    (key) =>
      Object.hasOwn(b, key) && Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  )
}

/**
 * Joins a keys array into a content-identity dependency string. `\u0000`
 * cannot appear in the id-derived segments of schema keys (same assumption as
 * the existing SESSION_ID_SEPARATOR usage), so the join is unambiguous.
 */
const CACHE_KEYS_DEP_SEPARATOR = '\u0000'

/**
 * Tier-agnostic core of the multi-key selector hooks: subscribes the given
 * keys and projects their physical values into a per-entry reference-stable
 * values tuple (the base snapshot), then delegates selector memoization and
 * bail-out to the official `use-sync-external-store/with-selector` — its memo
 * is private to the current concurrent render, which is the part a hand-rolled
 * ref-based cache cannot guarantee.
 *
 * File-private by design: `useSharedCacheSelector` is its only instantiation
 * today. If a memory/persist-tier aggregation need appears, add another thin
 * shell here — do not export this core ahead of that consumer.
 */
function useCacheKeysSelector<Values, Selection>(
  keys: readonly string[],
  subscribeKey: (key: string, onStoreChange: () => void) => () => void,
  readKey: (key: string) => unknown,
  selector: (values: Values) => Selection,
  isEqual: (a: Selection, b: Selection) => boolean
): Selection {
  // Consumers may pass a fresh keys array every render — stabilize on content,
  // not reference. A content/order change is a snapshot-shape change: it
  // rebuilds the subscription set and the snapshot closure together, keeping
  // the subscription set and the snapshot read set the same by construction.
  const keysDep = keys.join(CACHE_KEYS_DEP_SEPARATOR)
  const stableKeys = useMemo<readonly string[]>(
    () => [...keys],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keysDep is the content identity of `keys`
    [keysDep]
  )

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const disposers = stableKeys.map((key) => subscribeKey(key, onStoreChange))
      return () => disposers.forEach((dispose) => dispose())
    },
    [stableKeys, subscribeKey]
  )

  // Idempotent base snapshot: reuse the same tuple while every entry is
  // Object.is-unchanged, create a new tuple as soon as any entry changed.
  // This satisfies getSnapshot's caching contract (no "getSnapshot should be
  // cached" warnings) without a store-level version counter.
  const getSnapshot = useMemo(() => {
    let cachedValues: readonly unknown[] | undefined

    return () => {
      const nextValues = stableKeys.map((key) => readKey(key))
      const prevValues = cachedValues
      if (
        prevValues !== undefined &&
        nextValues.length === prevValues.length &&
        nextValues.every((value, index) => Object.is(value, prevValues[index]))
      ) {
        return prevValues
      }

      cachedValues = nextValues
      return nextValues
    }
  }, [stableKeys, readKey]) as () => Values

  return useSyncExternalStoreWithSelector(subscribe, getSnapshot, getSnapshot, selector, isEqual)
}

const subscribeSharedKey = (key: string, onStoreChange: () => void): (() => void) =>
  cacheService.subscribe(key, onStoreChange)

const readSharedKey = (key: string): unknown => cacheService.getSharedSnapshot(key as SharedCacheKey)

/**
 * React hook for READ-ONLY aggregate observation of MULTIPLE cross-window
 * shared cache keys through a selector.
 *
 * This is the multi-key sibling of `useSharedCacheValue` — same zero-side-effect
 * contract (no default write-back, no pin, snapshot via the pure physical read)
 * — for the cases the Rules of Hooks make impossible with per-key hooks: a
 * dynamic number of keys whose values must be aggregated into one derived
 * result (a Record/Map/pair of booleans), not rendered as per-key subtrees.
 *
 * Contract:
 * - `keys` is both the subscription set and the ONLY snapshot read set. The
 *   selector receives the corresponding values tuple (same order as `keys`,
 *   `undefined` on physical miss) and must not read `cacheService` itself —
 *   a key read outside the subscription set would go silently stale.
 * - No `useMemo` needed around `keys`: the hook stabilizes on content, and a
 *   content/order change re-subscribes and rebuilds the tuple.
 * - The values tuple is reference-stable per entry: unchanged entries keep
 *   their identity, and a fully unchanged tuple keeps ITS identity — while
 *   the selector/isEqual identities are also stable, the committed selection
 *   is reused without re-running the selector.
 * - `selector` and `isEqual` may be inline closures: a changed identity
 *   re-runs the selector once against the current tuple, then `isEqual`
 *   decides whether the committed selection (and its reference) is kept.
 *   Inline selectors are correct but not free — hoist or memoize an
 *   expensive one. When `isEqual` accepts the fresh selection as equal to
 *   the committed one, the component does NOT re-render.
 *
 * Consumer discipline (violations produce silently wrong or unstable output):
 * - **Zip-source coherence**: when zipping `values[index]` back with ids or
 *   entities, derive `keys` and the zip source from the SAME memoized array
 *   (e.g. one `uniqueIds`) — computing them independently can misalign on
 *   sort/dedup differences.
 * - **Reference-stable fallbacks**: a cache-miss fallback object/array inside
 *   the selector must be a module-level constant (or a stable memo) — never a
 *   fresh `?? []` / `?? {}` per run, which defeats the shallow comparison.
 * - `isEqual` defaults to {@link shallowEqual}; `Map`/`Set` or domain-value
 *   selections need an explicit comparator.
 *
 * @param keys - Schema-defined shared cache keys (fixed or template instances)
 * @param selector - Pure projection from the values tuple to the selection
 * @param isEqual - Selection comparator gating commit/bail-out (default {@link shallowEqual})
 * @returns The selected value; its reference is stable while `isEqual` holds
 *
 * @example
 * ```typescript
 * const EMPTY_TOOLS: McpTool[] = [] // module-level: reference-stable fallback
 *
 * function useMcpToolsByServer(serverIds: readonly string[]): Record<string, McpTool[]> {
 *   const uniqueIds = useMemo(() => Array.from(new Set(serverIds)).sort(), [serverIds])
 *   return useSharedCacheSelector(
 *     uniqueIds.map((id) => `mcp.tools.${id}` as const),
 *     (values) => Object.fromEntries(uniqueIds.map((id, i): [string, McpTool[]] => [id, values[i] ?? EMPTY_TOOLS]))
 *   )
 * }
 * ```
 */
export function useSharedCacheSelector<const Keys extends readonly SharedCacheKey[], Selection>(
  keys: Keys,
  selector: (values: SharedCacheValues<Keys>) => Selection,
  isEqual: (a: Selection, b: Selection) => boolean = shallowEqual
): Selection {
  return useCacheKeysSelector(keys, subscribeSharedKey, readSharedKey, selector, isEqual)
}

/**
 * React hook for persistent cache with localStorage
 *
 * Use this for data that needs to persist across app restarts and be shared between all windows.
 * Data is automatically saved to localStorage.
 *
 * @param key - Cache key from the predefined schema
 * @returns [value, setValue] - Similar to useState but persisted and shared across all windows
 *
 * @example
 * ```typescript
 * // Persisted across app restarts
 * const [userPrefs, setUserPrefs] = usePersistCache('user.preferences')
 *
 * // Automatically saved and synced across all windows
 * const [appSettings, setAppSettings] = usePersistCache('app.settings')
 *
 * // Changes are automatically saved
 * setUserPrefs({ theme: 'dark', language: 'en' })
 *
 * // Functional update — resolved against the latest persisted value
 * setPinned((prev) => [tab, ...prev.filter((t) => t.id !== tab.id)].slice(0, 10))
 * ```
 *
 * @remarks
 * The setter accepts a value or an updater `(prev) => next`, resolved against the
 * latest persisted value (`getPersist`, which always returns the stored value or
 * the schema default). Keep the updater pure and return a new value (see `useCache`).
 */
export function usePersistCache<K extends RendererPersistCacheKey>(
  key: K
): [RendererPersistCacheSchema[K], (value: CacheSetStateAction<RendererPersistCacheSchema[K]>) => void] {
  /**
   * Subscribe to persist cache changes using React's useSyncExternalStore
   * This ensures the component re-renders when the persist cache value changes
   */
  const value = useSyncExternalStore(
    useCallback((callback) => cacheService.subscribe(key, callback), [key]),
    useCallback(() => cacheService.getPersist(key), [key]),
    useCallback(() => cacheService.getPersist(key), [key]) // SSR snapshot
  )

  /**
   * Register this hook as actively using the persist cache key
   * This prevents the cache service from deleting the key while the hook is active
   * Note: Persist cache keys are predefined and generally not deleted
   */
  useEffect(() => {
    cacheService.registerHook(key)
    return () => cacheService.unregisterHook(key)
  }, [key])

  /**
   * Memoized setter function for updating the persist cache value.
   * Changes will be synchronized across all windows and persisted to localStorage.
   * Accepts a concrete value or a functional updater `(prev) => next` resolved
   * against the latest persisted value (`getPersist` never returns undefined).
   * @param newValue - New value, or an updater computing it from the latest value
   */
  const setValue = useCallback(
    (newValue: CacheSetStateAction<RendererPersistCacheSchema[K]>) => {
      if (typeof newValue === 'function') {
        const prev = cacheService.getPersist(key) as ReadonlyValue<RendererPersistCacheSchema[K]>
        cacheService.setPersist(key, newValue(prev))
      } else {
        cacheService.setPersist(key, newValue)
      }
    },
    [key]
  )

  return [value, setValue]
}
