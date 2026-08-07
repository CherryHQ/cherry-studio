import { describe, expect, it, vi } from 'vitest'

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: warnMock, debug: vi.fn(), silly: vi.fn() })
  }
}))

const { resolveKnowledgeBaseScope } = await import('../knowledgeScope')

describe('resolveKnowledgeBaseScope', () => {
  describe('a static binding is a ceiling, not a floor', () => {
    it('narrows the binding to the selection when the user picked a subset', () => {
      expect(resolveKnowledgeBaseScope(['kb-1', 'kb-2'], ['kb-1'])).toEqual(['kb-1'])
    })

    it('never widens the binding, and warns about the ids it dropped', () => {
      warnMock.mockClear()

      expect(resolveKnowledgeBaseScope(['kb-1'], ['kb-1', 'kb-private'])).toEqual(['kb-1'])

      expect(warnMock).toHaveBeenCalledWith(expect.stringContaining('outside the static binding'), {
        outOfScopeIds: ['kb-private']
      })
    })

    it('keeps the whole binding when the selection is entirely out of scope', () => {
      // No valid narrowing is the same as no narrowing at all — a bogus or stale renderer payload must
      // not silently cut a bound assistant off from its own bases.
      expect(resolveKnowledgeBaseScope(['kb-1', 'kb-2'], ['kb-private'])).toEqual(['kb-1', 'kb-2'])
    })

    it('keeps the whole binding when the selection is empty', () => {
      expect(resolveKnowledgeBaseScope(['kb-1'], [])).toEqual(['kb-1'])
      expect(resolveKnowledgeBaseScope(['kb-1'], undefined)).toEqual(['kb-1'])
    })
  })

  it('lets the selection define the scope when there is no binding', () => {
    expect(resolveKnowledgeBaseScope([], ['kb-1', 'kb-2'])).toEqual(['kb-1', 'kb-2'])
    expect(resolveKnowledgeBaseScope(undefined, ['kb-2'])).toEqual(['kb-2'])
  })

  it('returns an empty scope when neither source has ids', () => {
    expect(resolveKnowledgeBaseScope(undefined, undefined)).toEqual([])
    expect(resolveKnowledgeBaseScope([], [])).toEqual([])
  })

  describe('canonical output', () => {
    // Callers compare scopes by value and hash them into rebuild signatures, so equal scopes must
    // serialize identically no matter which branch produced them or how the input was ordered.
    it('deduplicates and sorts the selection branch', () => {
      expect(resolveKnowledgeBaseScope([], ['kb-2', 'kb-1', 'kb-2'])).toEqual(['kb-1', 'kb-2'])
    })

    it('deduplicates and sorts the binding branch', () => {
      expect(resolveKnowledgeBaseScope(['kb-2', 'kb-1', 'kb-2'], undefined)).toEqual(['kb-1', 'kb-2'])
    })

    it('deduplicates and sorts the narrowed branch', () => {
      expect(resolveKnowledgeBaseScope(['kb-1', 'kb-2', 'kb-3'], ['kb-3', 'kb-1', 'kb-3'])).toEqual(['kb-1', 'kb-3'])
    })
  })
})
