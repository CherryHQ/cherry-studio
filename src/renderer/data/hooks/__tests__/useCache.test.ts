/**
 * Tests for the useCache family of hooks. Three concerns in one file:
 *
 * 1. Template key type inference (compile-time) — schema key/value typing.
 * 2. Functional updater runtime behaviour — `setX(prev => next)` resolves `prev`
 *    from the LATEST stored value, fixing the read-modify-write race in issue
 *    #16460. Exercised against the REAL CacheService + hooks (renderer.setup.ts
 *    mocks both globally, so we undo those mocks below).
 * 3. Readonly updater static guarantees (compile-time) — `prev` is shallow
 *    readonly so mutating it in place (a footgun the `isEqual` short-circuit
 *    would silently swallow) is a compile error. These assertions are enforced
 *    by `tsgo`: each `@ts-expect-error` must suppress a real error.
 */

import { cacheService } from '@data/CacheService'
import { useCache, usePersistCache, useSharedCache, useSharedCacheValue } from '@data/hooks/useCache'
import type {
  ExpandTemplateKey,
  InferSharedCacheValue,
  InferUseCacheValue,
  IsTemplateKey,
  ProcessKey,
  SharedCacheKey,
  UseCacheCasualKey,
  UseCacheKey
} from '@shared/data/cache/cacheSchemas'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

// Undo the global mocks from renderer.setup.ts — the functional-updater tests
// need the real wiring so the hook setter and our assertions read/write the same
// single store. (The type-only suites below don't touch these modules at runtime.)
vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

describe('Template Key Type Utilities', () => {
  describe('IsTemplateKey', () => {
    it('should detect template keys as true', () => {
      // Using expectTypeOf for type-level assertions
      const templateResult1: IsTemplateKey<'scroll.position.${id}'> = true
      const templateResult2: IsTemplateKey<'entity.cache.${type}_${id}'> = true
      expect(templateResult1).toBe(true)
      expect(templateResult2).toBe(true)
    })

    it('should detect fixed keys as false', () => {
      const fixedResult1: IsTemplateKey<'app.user.avatar'> = false
      const fixedResult2: IsTemplateKey<'chat.web_search.searching'> = false
      expect(fixedResult1).toBe(false)
      expect(fixedResult2).toBe(false)
    })
  })

  describe('ExpandTemplateKey', () => {
    it('should expand single placeholder', () => {
      // Type assertion: 'scroll.position.topic123' should extend the expanded type
      type Expanded = ExpandTemplateKey<'scroll.position.${id}'>
      const key1: Expanded = 'scroll.position.topic123'
      const key2: Expanded = 'scroll.position.abc'
      expect(key1).toBe('scroll.position.topic123')
      expect(key2).toBe('scroll.position.abc')
    })

    it('should expand multiple placeholders', () => {
      type Expanded = ExpandTemplateKey<'entity.cache.${type}_${id}'>
      const key1: Expanded = 'entity.cache.user_123'
      const key2: Expanded = 'entity.cache.post_456'
      expect(key1).toBe('entity.cache.user_123')
      expect(key2).toBe('entity.cache.post_456')
    })

    it('should leave fixed keys unchanged', () => {
      type Expanded = ExpandTemplateKey<'app.user.avatar'>
      const key: Expanded = 'app.user.avatar'
      expect(key).toBe('app.user.avatar')
    })
  })

  describe('ProcessKey', () => {
    it('should expand template keys', () => {
      type Processed = ProcessKey<'scroll.position.${topicId}'>
      const key: Processed = 'scroll.position.topic123'
      expect(key).toBe('scroll.position.topic123')
    })

    it('should keep fixed keys unchanged', () => {
      type Processed = ProcessKey<'app.user.avatar'>
      const key: Processed = 'app.user.avatar'
      expect(key).toBe('app.user.avatar')
    })
  })

  describe('UseCacheKey', () => {
    it('should include fixed keys', () => {
      const key1: UseCacheKey = 'app.user.avatar'
      const key2: UseCacheKey = 'chat.web_search.searching'
      expect(key1).toBe('app.user.avatar')
      expect(key2).toBe('chat.web_search.searching')
    })

    it('should match template patterns', () => {
      const key1: UseCacheKey = 'scroll.position.topic123'
      const key2: UseCacheKey = 'scroll.position.abc-def'
      const key3: UseCacheKey = 'entity.cache.user_456'
      expect(key1).toBe('scroll.position.topic123')
      expect(key2).toBe('scroll.position.abc-def')
      expect(key3).toBe('entity.cache.user_456')
    })
  })

  describe('InferUseCacheValue', () => {
    it('should infer value type for fixed keys', () => {
      // These type assertions verify the type system works
      const avatarType: InferUseCacheValue<'app.user.avatar'> = 'test'
      const generatingType: InferUseCacheValue<'chat.web_search.searching'> = true
      expectTypeOf(avatarType).toBeString()
      expectTypeOf(generatingType).toBeBoolean()
    })

    it('should infer value type for template key instances', () => {
      const scrollType: InferUseCacheValue<'scroll.position.topic123'> = 100
      const entityType: InferUseCacheValue<'entity.cache.user_456'> = { loaded: true, data: null }
      expectTypeOf(scrollType).toBeNumber()
      expectTypeOf(entityType).toMatchTypeOf<{ loaded: boolean; data: unknown }>()
    })

    it('should return never for unknown keys', () => {
      // Unknown key should infer to never
      type UnknownValue = InferUseCacheValue<'unknown.key.here'>
      expectTypeOf<UnknownValue>().toBeNever()
    })
  })

  describe('UseCacheCasualKey', () => {
    it('should block fixed schema keys', () => {
      // Fixed keys should resolve to never
      type BlockedFixed = UseCacheCasualKey<'app.user.avatar'>
      expectTypeOf<BlockedFixed>().toBeNever()
    })

    it('should block template pattern matches', () => {
      // Keys matching template patterns should resolve to never
      type BlockedTemplate = UseCacheCasualKey<'scroll.position.topic123'>
      expectTypeOf<BlockedTemplate>().toBeNever()
    })

    it('should allow non-schema keys', () => {
      // Non-schema keys should pass through
      type AllowedKey = UseCacheCasualKey<'my.custom.key'>
      const key: AllowedKey = 'my.custom.key'
      expect(key).toBe('my.custom.key')
    })
  })

  describe('Runtime template key detection', () => {
    it('should correctly detect template keys', () => {
      const isTemplate = (key: string) => key.includes('${') && key.includes('}')

      expect(isTemplate('scroll.position.${id}')).toBe(true)
      expect(isTemplate('entity.cache.${type}_${id}')).toBe(true)
      expect(isTemplate('app.user.avatar')).toBe(false)
      expect(isTemplate('chat.web_search.searching')).toBe(false)
    })
  })

  describe('SharedCacheKey', () => {
    it('should include fixed keys', () => {
      const key: SharedCacheKey = 'chat.web_search.active_searches'
      expect(key).toBe('chat.web_search.active_searches')
    })

    it('should match template patterns', () => {
      const key1: SharedCacheKey = 'web_search.provider.last_used_key.google'
      const key2: SharedCacheKey = 'ocr.provider.last_used_key.tesseract'
      expect(key1).toBe('web_search.provider.last_used_key.google')
      expect(key2).toBe('ocr.provider.last_used_key.tesseract')
    })
  })

  describe('InferSharedCacheValue', () => {
    it('should infer value type for fixed keys', () => {
      // 'chat.web_search.active_searches' -> CacheActiveSearches
      expectTypeOf<InferSharedCacheValue<'chat.web_search.active_searches'>>().toMatchTypeOf<Record<string, unknown>>()
    })

    it('should infer value type for template key instances', () => {
      const webSearchLastKey: InferSharedCacheValue<'web_search.provider.last_used_key.google'> = 'key-1'
      const ocrLastKey: InferSharedCacheValue<'ocr.provider.last_used_key.tesseract'> = 'key-2'
      expectTypeOf(webSearchLastKey).toBeString()
      expectTypeOf(ocrLastKey).toBeString()
    })

    it('should return never for unknown keys', () => {
      type UnknownValue = InferSharedCacheValue<'unknown.shared.key'>
      expectTypeOf<UnknownValue>().toBeNever()
    })
  })
})

// ============================================================================
// Functional updater — runtime behaviour (real CacheService + real hooks)
// ============================================================================

describe('functional updater (runtime)', () => {
  beforeEach(() => {
    // CacheService best-effort broadcasts cross-window sync through window.api.cache;
    // stub it so the in-process Map operations we assert on run without warnings.
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        cache: {
          broadcastSync: vi.fn(),
          onSync: vi.fn(),
          getAllShared: vi.fn(async () => ({}))
        }
      }
    })

    // Reset the singleton keys these suites touch (state persists across tests).
    cacheService.set('chat.selected_message_ids', [])
    cacheService.setShared('feature.api_gateway.running', false)
    cacheService.setPersist('ui.emoji.recently_used', [])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('memory tier (useCache)', () => {
    it('resolves the updater against the latest stored value (issue #16460 race)', () => {
      cacheService.set('chat.selected_message_ids', ['A', 'B'])
      const { result } = renderHook(() => useCache('chat.selected_message_ids'))
      expect(result.current[0]).toEqual(['A', 'B'])

      // A concurrent write lands after the render snapshot (e.g. another action
      // appends 'C' while an async handler is mid-flight).
      act(() => {
        cacheService.set('chat.selected_message_ids', ['A', 'B', 'C'])
      })

      // The functional updater must see ['A','B','C'] (latest), so removing 'A'
      // keeps the concurrently-added 'C'.
      act(() => {
        result.current[1]((prev) => prev.filter((id) => id !== 'A'))
      })

      expect(cacheService.get('chat.selected_message_ids')).toEqual(['B', 'C'])
    })

    it('negative control: a stale-snapshot concrete write loses the concurrent change', () => {
      cacheService.set('chat.selected_message_ids', ['A', 'B'])
      const { result } = renderHook(() => useCache('chat.selected_message_ids'))
      const staleSnapshot = result.current[0] // ['A', 'B'] captured before the race

      act(() => {
        cacheService.set('chat.selected_message_ids', ['A', 'B', 'C'])
      })

      // The pre-fix code path: compute from the stale snapshot and write a value.
      act(() => {
        result.current[1](staleSnapshot.filter((id) => id !== 'A'))
      })

      // Demonstrates the bug the functional form fixes: 'C' is clobbered.
      expect(cacheService.get('chat.selected_message_ids')).toEqual(['B'])
    })

    it('still accepts a concrete value (backward compatible)', () => {
      const { result } = renderHook(() => useCache('chat.selected_message_ids'))
      act(() => {
        result.current[1](['X', 'Y'])
      })
      expect(cacheService.get('chat.selected_message_ids')).toEqual(['X', 'Y'])
    })
  })

  describe('shared tier (useSharedCache)', () => {
    it('resolves the updater against the latest shared value', () => {
      cacheService.setShared('feature.api_gateway.running', false)
      const { result } = renderHook(() => useSharedCache('feature.api_gateway.running'))
      act(() => {
        result.current[1]((prev) => !prev)
      })
      expect(cacheService.getShared('feature.api_gateway.running')).toBe(true)
    })

    it('still accepts a concrete value (backward compatible)', () => {
      const { result } = renderHook(() => useSharedCache('feature.api_gateway.running'))
      act(() => {
        result.current[1](true)
      })
      expect(cacheService.getShared('feature.api_gateway.running')).toBe(true)
    })
  })

  describe('read-only shared value (useSharedCacheValue)', () => {
    it('returns the current shared value', () => {
      cacheService.setShared('feature.api_gateway.running', true)
      const { result } = renderHook(() => useSharedCacheValue('feature.api_gateway.running'))
      expect(result.current).toBe(true)
    })

    it('does not seed a default on mount, so it cannot clobber a key the owner has not populated', () => {
      // Unset the key: `useSharedCache` would seed its schema default here and broadcast it to Main.
      cacheService.deleteShared('feature.api_gateway.running')
      const setSpy = vi.spyOn(cacheService, 'setShared')

      renderHook(() => useSharedCacheValue('feature.api_gateway.running'))

      expect(setSpy).not.toHaveBeenCalled()
    })
  })

  describe('persist tier (usePersistCache)', () => {
    it('resolves the updater against the latest persisted value', () => {
      cacheService.setPersist('ui.emoji.recently_used', ['😀'])
      const { result } = renderHook(() => usePersistCache('ui.emoji.recently_used'))
      act(() => {
        result.current[1]((prev) => ['🎉', ...prev])
      })
      expect(cacheService.getPersist('ui.emoji.recently_used')).toEqual(['🎉', '😀'])
    })

    it('still accepts a concrete value (backward compatible)', () => {
      const { result } = renderHook(() => usePersistCache('ui.emoji.recently_used'))
      act(() => {
        result.current[1](['🔥'])
      })
      expect(cacheService.getPersist('ui.emoji.recently_used')).toEqual(['🔥'])
    })
  })
})

// ============================================================================
// Readonly updater — static (compile-time) guarantees
//
// The real assertions run at typecheck (`tsgo`): every `@ts-expect-error` must
// suppress a genuine error and every `expectTypeOf` must hold. If the readonly
// guard regresses, the directives become "unused" and `pnpm typecheck` fails
// here. Mutation lines live inside functions that are never invoked, so nothing
// mutates at runtime; the `expect(...).toBeTypeOf` calls give Vitest a pass/fail.
// ============================================================================

// Derive the updater's `prev` type straight from each hook's real signature:
// setter = return[1]; its arg is `V | ((prev: ReadonlyValue<V>) => V)`; we pull
// out the function constituent and read its first parameter.
type Updater<Arg> = Extract<Arg, (...args: never[]) => unknown>
type MemorySetterArg<K extends Parameters<typeof useCache>[0]> = Parameters<ReturnType<typeof useCache<K>>[1]>[0]
type MemoryPrev<K extends Parameters<typeof useCache>[0]> = Parameters<Updater<MemorySetterArg<K>>>[0]

type SharedSetterArg<K extends Parameters<typeof useSharedCache>[0]> = Parameters<
  ReturnType<typeof useSharedCache<K>>[1]
>[0]
type SharedPrev<K extends Parameters<typeof useSharedCache>[0]> = Parameters<Updater<SharedSetterArg<K>>>[0]

type PersistSetterArg<K extends Parameters<typeof usePersistCache>[0]> = Parameters<
  ReturnType<typeof usePersistCache<K>>[1]
>[0]
type PersistPrev<K extends Parameters<typeof usePersistCache>[0]> = Parameters<Updater<PersistSetterArg<K>>>[0]

// Representative value types
type SelectedIds = InferUseCacheValue<'chat.selected_message_ids'> // string[]
type KeepAlive = InferUseCacheValue<'mini_app.opened_keep_alive'> // CacheMiniAppType[]
type GatewayRunning = InferSharedCacheValue<'feature.api_gateway.running'> // boolean
type JobProgress = InferSharedCacheValue<'jobs.progress.job-1'> // { progress: number, ... }

describe('readonly updater (static guarantees)', () => {
  describe('prev type shape', () => {
    it('array value → shallow readonly array', () => {
      expectTypeOf<MemoryPrev<'chat.selected_message_ids'>>().toEqualTypeOf<Readonly<SelectedIds>>()
      expectTypeOf<MemoryPrev<'chat.selected_message_ids'>>().toEqualTypeOf<readonly string[]>()
      expect(true).toBe(true)
    })

    it('object value → shallow readonly object', () => {
      expectTypeOf<SharedPrev<'jobs.progress.job-1'>>().toEqualTypeOf<Readonly<JobProgress>>()
      expect(true).toBe(true)
    })

    it('primitive value → passes through unchanged (not wrapped)', () => {
      // ReadonlyValue<boolean> must stay `boolean`, else `prev => !prev` and
      // `prev => prev + 1` would stop compiling.
      expectTypeOf<SharedPrev<'feature.api_gateway.running'>>().toEqualTypeOf<GatewayRunning>()
      expectTypeOf<SharedPrev<'feature.api_gateway.running'>>().toEqualTypeOf<boolean>()
      expect(true).toBe(true)
    })

    it('shallow only — array elements are NOT deep-frozen', () => {
      // Element type stays the mutable value's element (we intentionally avoid a
      // recursive DeepReadonly, which caused filter/map assignability friction).
      expectTypeOf<MemoryPrev<'mini_app.opened_keep_alive'>[number]>().toEqualTypeOf<KeepAlive[number]>()
      expect(true).toBe(true)
    })
  })

  describe('in-place mutation is a compile error (footgun blocked)', () => {
    it('array: push / sort / index / length assignment all rejected', () => {
      // Never invoked — defining it is enough for tsgo to enforce the guards.
      const guard = (prev: MemoryPrev<'chat.selected_message_ids'>): readonly string[] => {
        // @ts-expect-error `push` does not exist on a readonly array
        prev.push('x')
        // @ts-expect-error `sort` mutates and is absent on a readonly array
        prev.sort()
        // @ts-expect-error index signature on a readonly array only permits reading
        prev[0] = 'x'
        // @ts-expect-error `length` is read-only on a readonly array
        prev.length = 0
        return prev
      }
      expect(guard).toBeTypeOf('function')
    })

    it('object: property assignment rejected', () => {
      const guard = (prev: SharedPrev<'jobs.progress.job-1'>): Readonly<JobProgress> => {
        // @ts-expect-error cannot assign to a read-only property of `prev`
        prev.progress = 0
        return prev
      }
      expect(guard).toBeTypeOf('function')
    })
  })

  describe('pure (non-mutating) updaters still compile', () => {
    it('array filter / map / spread return the mutable value type', () => {
      const pure = (prev: MemoryPrev<'chat.selected_message_ids'>) => {
        const filtered: SelectedIds = prev.filter((id) => id !== 'a')
        const mapped: SelectedIds = prev.map((id) => id)
        const copied: SelectedIds = [...prev]
        return { filtered, mapped, copied }
      }
      expect(pure).toBeTypeOf('function')
    })

    it('primitive negation / arithmetic compile', () => {
      const flip = (prev: SharedPrev<'feature.api_gateway.running'>): boolean => !prev
      const persistCopy = (prev: PersistPrev<'ui.emoji.recently_used'>): string[] => [...prev]
      expect(flip).toBeTypeOf('function')
      expect(persistCopy).toBeTypeOf('function')
    })
  })
})
