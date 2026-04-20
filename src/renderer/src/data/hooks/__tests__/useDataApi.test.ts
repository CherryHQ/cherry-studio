import type * as RendererConstantModule from '@renderer/config/constant'
import { describe, expect, it, vi } from 'vitest'

// Tests exercise the real implementation; the global renderer setup otherwise
// replaces this module with a mock for consuming components.
vi.unmock('@data/hooks/useDataApi')

// `isDev` reads `window.electron.process.env.NODE_ENV`, which isn't populated
// in the Vitest environment. Force it to true so the dev-only pattern
// assertions fire during these tests.
vi.mock('@renderer/config/constant', async (importOriginal) => {
  const actual = await importOriginal<typeof RendererConstantModule>()
  return { ...actual, isDev: true }
})

import { __testing } from '../useDataApi'

const { createKeyMatcher, createMultiKeyMatcher, resolveTemplate, buildSWRKey } = __testing

describe('createKeyMatcher', () => {
  it('exact-matches a plain path against [path] cache keys', () => {
    const match = createKeyMatcher('/providers')
    expect(match(['/providers'])).toBe(true)
    expect(match(['/providers', { limit: 10 }])).toBe(true)
    expect(match(['/providers/abc'])).toBe(false)
    expect(match(['/models'])).toBe(false)
  })

  it('prefix-matches `/*` patterns over resolved sub-paths', () => {
    const match = createKeyMatcher('/providers/*')
    expect(match(['/providers/abc'])).toBe(true)
    expect(match(['/providers/abc/api-keys'])).toBe(true)
    expect(match(['/providers/abc/api-keys/key-001'])).toBe(true)
    // Exact '/providers' shouldn't match a `/*` prefix (prefix expects at least one child segment)
    expect(match(['/providers'])).toBe(false)
  })

  it('preserves trailing slash so sibling resources are not misidentified', () => {
    const match = createKeyMatcher('/providers/*')
    // /providers-archived shares a prefix string but not a path segment boundary
    expect(match(['/providers-archived'])).toBe(false)
    expect(match(['/providers-archived/xyz'])).toBe(false)
  })

  it('rejects non-array keys and keys whose first slot is non-string', () => {
    const match = createKeyMatcher('/providers')
    expect(match('/providers')).toBe(false)
    expect(match(null)).toBe(false)
    expect(match(undefined)).toBe(false)
    expect(match([123])).toBe(false)
    expect(match([{ path: '/providers' }])).toBe(false)
  })
})

describe('createMultiKeyMatcher', () => {
  it('supports a mix of exact and `/*` prefix patterns', () => {
    const match = createMultiKeyMatcher(['/providers', '/models/*'])
    expect(match(['/providers'])).toBe(true)
    expect(match(['/models/openai-gpt-4'])).toBe(true)
    expect(match(['/models/openai-gpt-4/variants'])).toBe(true)
    expect(match(['/providers/abc'])).toBe(false) // exact, not prefix
    expect(match(['/topics'])).toBe(false)
  })

  it('returns false for invalid key shapes', () => {
    const match = createMultiKeyMatcher(['/providers', '/providers/*'])
    expect(match({ path: '/providers' })).toBe(false)
    expect(match([])).toBe(false)
    expect(match([null])).toBe(false)
  })
})

describe('dev-mode pattern assertions', () => {
  // `assertValidPattern` only throws when `isDev === true`. This suite mocks
  // `@renderer/config/constant` at the top of the file to force `isDev: true`.
  it('rejects non-segment wildcards like "/foo*" on single-key matcher', () => {
    expect(() => createKeyMatcher('/providers*')).toThrow(/wildcard must be a full path segment/)
  })

  it('rejects bare wildcards on single-key matcher', () => {
    expect(() => createKeyMatcher('/*')).toThrow(/bare wildcard/)
    expect(() => createKeyMatcher('*')).toThrow()
  })

  it('rejects invalid patterns when found in a multi-key array', () => {
    expect(() => createMultiKeyMatcher(['/providers', '/m*'])).toThrow(/wildcard must be a full path segment/)
    expect(() => createMultiKeyMatcher(['/valid/*', '/*'])).toThrow(/bare wildcard/)
  })
})

describe('resolveTemplate', () => {
  it('passes through paths without placeholders', () => {
    expect(resolveTemplate('/providers')).toBe('/providers')
    expect(resolveTemplate('/providers', { providerId: 'abc' })).toBe('/providers')
  })

  it('substitutes a single `:param`', () => {
    expect(resolveTemplate('/providers/:providerId', { providerId: 'abc' })).toBe('/providers/abc')
  })

  it('substitutes multiple `:param` tokens in the same path', () => {
    expect(
      resolveTemplate('/providers/:providerId/api-keys/:keyId', {
        providerId: 'abc',
        keyId: 'key-001'
      })
    ).toBe('/providers/abc/api-keys/key-001')
  })

  it('substitutes greedy `:name*` placeholders, preserving slashes in the value', () => {
    expect(
      resolveTemplate('/models/:uniqueModelId*', {
        uniqueModelId: 'openai:gpt-4/variant/with-slashes'
      })
    ).toBe('/models/openai:gpt-4/variant/with-slashes')
  })

  it('accepts numeric param values', () => {
    expect(resolveTemplate('/topics/:topicId', { topicId: 42 })).toBe('/topics/42')
  })

  it('throws when a required placeholder is missing', () => {
    expect(() => resolveTemplate('/providers/:providerId', {})).toThrow(/Missing param "providerId"/)
    expect(() => resolveTemplate('/providers/:providerId/api-keys/:keyId', { providerId: 'abc' })).toThrow(
      /Missing param "keyId"/
    )
  })
})

describe('buildSWRKey cache-key equivalence', () => {
  // This is the critical invariant: a template + resolveTemplate must produce
  // byte-for-byte identical keys to a pre-resolved concrete path. Drift here
  // causes phantom refresh misses that are extremely hard to debug.

  it('produces identical keys for template+params and concrete helper paths (no query)', () => {
    const keyFromTemplate = buildSWRKey(resolveTemplate('/providers/:providerId', { providerId: 'abc' }))
    const keyFromConcrete = buildSWRKey('/providers/abc')
    expect(keyFromTemplate).toEqual(keyFromConcrete)
    expect(keyFromTemplate).toMatchInlineSnapshot(`
      [
        "/providers/abc",
      ]
    `)
  })

  it('produces identical keys when query is provided', () => {
    const query = { limit: 10 }
    const keyFromTemplate = buildSWRKey(resolveTemplate('/providers/:providerId', { providerId: 'abc' }), query)
    const keyFromConcrete = buildSWRKey('/providers/abc', query)
    expect(keyFromTemplate).toEqual(keyFromConcrete)
    expect(keyFromTemplate).toMatchInlineSnapshot(`
      [
        "/providers/abc",
        {
          "limit": 10,
        },
      ]
    `)
  })

  it('omits query slot when query is empty', () => {
    expect(buildSWRKey('/providers/abc', {})).toEqual(['/providers/abc'])
    expect(buildSWRKey('/providers/abc', undefined)).toEqual(['/providers/abc'])
  })

  it('includes query slot as-is when non-empty (field order preserved via object literal)', () => {
    const query = { limit: 10, cursor: 'x' }
    expect(buildSWRKey('/providers/abc', query)).toEqual(['/providers/abc', query])
  })
})
