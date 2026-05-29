import { describe, expect, it } from 'vitest'

import { ApiServer } from '../ApiServer'

// The constructor is private; cast to bypass for focused unit tests.
// extractPathParams() is a pure method and depends on no injected handlers,
// so an empty-handler instance is sufficient for testing path matching.
function createServer(): { extract: (pattern: string, path: string) => Record<string, string> | null } {
  const server = new (ApiServer as any)({})
  return {
    extract: (pattern: string, path: string) => server.extractPathParams(pattern, path)
  }
}

describe('ApiServer.extractPathParams', () => {
  describe('plain params (backwards compatible)', () => {
    it('matches a single param segment', () => {
      const { extract } = createServer()
      expect(extract('/topics/:id', '/topics/abc')).toEqual({ id: 'abc' })
    })

    it('matches multiple param segments', () => {
      const { extract } = createServer()
      expect(extract('/models/:providerId/:modelId', '/models/openai/gpt-4')).toEqual({
        providerId: 'openai',
        modelId: 'gpt-4'
      })
    })

    it('returns null when static segment does not match', () => {
      const { extract } = createServer()
      expect(extract('/topics/:id', '/assistants/abc')).toBeNull()
    })

    it('returns null when path has extra segments for a non-greedy pattern', () => {
      const { extract } = createServer()
      expect(extract('/models/:providerId/:modelId', '/models/a/b/c')).toBeNull()
    })

    it('returns null when path has fewer segments', () => {
      const { extract } = createServer()
      expect(extract('/models/:providerId/:modelId', '/models/openai')).toBeNull()
    })
  })

  describe('greedy tail param (:name*)', () => {
    it('captures a single remaining segment', () => {
      const { extract } = createServer()
      expect(extract('/models/:uid*', '/models/openai::gpt-4')).toEqual({
        uid: 'openai::gpt-4'
      })
    })

    it('captures multiple remaining segments joined by /', () => {
      const { extract } = createServer()
      expect(extract('/models/:uid*', '/models/qwen::qwen/qwen3-vl')).toEqual({
        uid: 'qwen::qwen/qwen3-vl'
      })
    })

    it('captures deep paths with many slashes', () => {
      const { extract } = createServer()
      expect(extract('/models/:uid*', '/models/fireworks::accounts/fireworks/models/deepseek-v3p2')).toEqual({
        uid: 'fireworks::accounts/fireworks/models/deepseek-v3p2'
      })
    })

    it('requires at least one captured segment (greedy is not optional)', () => {
      const { extract } = createServer()
      expect(extract('/models/:uid*', '/models')).toBeNull()
    })

    it('combines leading params with trailing greedy capture', () => {
      const { extract } = createServer()
      expect(extract('/topics/:topicId/messages/:rest*', '/topics/t1/messages/m1/blocks/b1')).toEqual({
        topicId: 't1',
        rest: 'm1/blocks/b1'
      })
    })

    it('preserves raw characters without decoding', () => {
      const { extract } = createServer()
      // `::` and `%20` should be passed through untouched.
      expect(extract('/models/:uid*', '/models/openai::gpt-4%20turbo')).toEqual({
        uid: 'openai::gpt-4%20turbo'
      })
    })
  })

  describe('greedy middle param (:name* with static/plain trailing)', () => {
    it('captures middle segments anchored by a trailing static segment', () => {
      const { extract } = createServer()
      expect(extract('/models/:uid*/order', '/models/a/b/c/order')).toEqual({
        uid: 'a/b/c'
      })
    })

    it('captures a single middle segment', () => {
      const { extract } = createServer()
      expect(extract('/models/:uid*/order', '/models/qwen::qwen/order')).toEqual({
        uid: 'qwen::qwen'
      })
    })

    it('requires at least one captured segment for middle greedy', () => {
      const { extract } = createServer()
      expect(extract('/models/:uid*/order', '/models/order')).toBeNull()
    })

    it('returns null when trailing anchor does not match', () => {
      const { extract } = createServer()
      expect(extract('/models/:uid*/order', '/models/a/b/c')).toBeNull()
    })

    it('allows plain params in the trailing part', () => {
      const { extract } = createServer()
      expect(extract('/files/:path*/children/:childId', '/files/a/b/children/c')).toEqual({
        path: 'a/b',
        childId: 'c'
      })
    })

    it('supports greedy as the first segment (after root)', () => {
      const { extract } = createServer()
      expect(extract('/:uid*/order', '/a/b/order')).toEqual({ uid: 'a/b' })
    })

    it('rejects patterns with more than one greedy param', () => {
      const { extract } = createServer()
      // Two greedies create ambiguous splits — be defensive and refuse.
      expect(extract('/a/:x*/b/:y*/c', '/a/1/b/2/c')).toBeNull()
    })

    it('combines leading plain param, middle greedy, and trailing static anchor', () => {
      const { extract } = createServer()
      expect(
        extract('/providers/:providerId/models/:uid*/actions', '/providers/openai/models/qwen/qwen3-vl/actions')
      ).toEqual({
        providerId: 'openai',
        uid: 'qwen/qwen3-vl'
      })
    })
  })

  describe('greedy syntax edge cases', () => {
    it('does not treat a bare `:*` as greedy (length <= 2)', () => {
      const { extract } = createServer()
      // `:*` means a param named `*` (empty-ish) with no greedy semantics — must match
      // a single literal segment, not swallow remaining path.
      expect(extract('/foo/:*', '/foo/a/b')).toBeNull()
    })

    it('does not treat a non-param segment ending with * as greedy', () => {
      const { extract } = createServer()
      // `foo*` is not a param (no leading `:`) and must match literally.
      expect(extract('/foo*', '/foo*')).toEqual({})
      expect(extract('/foo*', '/foo/bar')).toBeNull()
    })
  })
})
