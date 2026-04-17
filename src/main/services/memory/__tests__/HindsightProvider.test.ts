/**
 * Unit tests for HindsightProvider.
 * HTTP calls are intercepted via vi.mock so no server is required.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

// Mock the hindsight-client module
const mockRetain = vi.fn().mockResolvedValue({})
const mockRetainBatch = vi.fn().mockResolvedValue({})
const mockRecall = vi.fn().mockResolvedValue({ results: [] })
const mockReflect = vi.fn().mockResolvedValue({ text: 'reflected', structured: null })
const mockListMemories = vi.fn().mockResolvedValue({ results: [] })

vi.mock('@vectorize-io/hindsight-client', () => ({
  HindsightClient: vi.fn().mockImplementation(() => ({
    retain: mockRetain,
    retainBatch: mockRetainBatch,
    recall: mockRecall,
    reflect: mockReflect,
    listMemories: mockListMemories
  }))
}))

// Mock global fetch for healthCheck
global.fetch = vi.fn().mockResolvedValue({ ok: true }) as typeof fetch

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'

import { HindsightProvider } from '../providers/HindsightProvider'

describe('HindsightProvider', () => {
  let provider: HindsightProvider

  beforeEach(async () => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'feature.memory.hindsight.base_url': 'http://localhost:8888',
      'feature.memory.hindsight.api_key': '',
      'feature.memory.hindsight.default_bank_prefix': 'cherry',
      'feature.memory.hindsight.reflect_enabled': true,
      'feature.memory.hindsight.timeout_ms': 5000,
      'feature.memory.bank_strategy': 'per_user',
      'feature.memory.current_user_id': 'test-user'
    })
    provider = new HindsightProvider()
    await provider.init()
  })

  it('has id "hindsight"', () => {
    expect(provider.id).toBe('hindsight')
  })

  it('capabilities.supportsReflect is true when preference is true', () => {
    expect(provider.capabilities.supportsReflect).toBe(true)
  })

  it('capabilities.serverSideExtraction is true', () => {
    expect(provider.capabilities.serverSideExtraction).toBe(true)
  })

  describe('add()', () => {
    it('calls retain for single string', async () => {
      const result = await provider.add('Alice works at Google')
      expect(mockRetain).toHaveBeenCalledWith(
        'cherry-test-user',
        'Alice works at Google',
        expect.objectContaining({ async: true })
      )
      expect(result).toHaveLength(1)
      expect(result[0].memory).toBe('Alice works at Google')
    })

    it('calls retainBatch for array of strings', async () => {
      const result = await provider.add(['fact one', 'fact two'])
      expect(mockRetainBatch).toHaveBeenCalled()
      expect(result).toHaveLength(1) // synthetic combined item
    })
  })

  describe('search()', () => {
    it('calls recall and maps results to MemoryItem[]', async () => {
      mockRecall.mockResolvedValueOnce({
        results: [{ id: 'abc', text: 'Alice works at Google', score: 0.95, type: 'world' }]
      })

      const result = await provider.search('What does Alice do?')
      expect(mockRecall).toHaveBeenCalledWith('cherry-test-user', 'What does Alice do?', expect.any(Object))
      expect(result.results).toHaveLength(1)
      expect(result.results[0].id).toBe('abc')
      expect(result.results[0].memory).toBe('Alice works at Google')
      expect(result.results[0].score).toBe(0.95)
    })

    it('returns empty results when recall returns empty', async () => {
      const result = await provider.search('nothing')
      expect(result.results).toHaveLength(0)
    })
  })

  describe('reflect()', () => {
    it('calls reflect on the client and maps the response', async () => {
      const result = await provider.reflect({ query: 'Tell me about Alice' })
      expect(mockReflect).toHaveBeenCalledWith('cherry-test-user', 'Tell me about Alice', expect.any(Object))
      expect(result.content).toBe('reflected')
    })
  })

  describe('healthCheck()', () => {
    it('returns true when fetch /health succeeds', async () => {
      const result = await provider.healthCheck()
      expect(result).toBe(true)
    })

    it('returns false when fetch throws', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('network error'))
      const result = await provider.healthCheck()
      expect(result).toBe(false)
    })
  })

  describe('bank strategy', () => {
    it('resolves per_user bank correctly', async () => {
      await provider.add('test', { userId: 'alice' })
      expect(mockRetain).toHaveBeenCalledWith('cherry-alice', expect.any(String), expect.any(Object))
    })

    it('uses global strategy when set', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.memory.bank_strategy', 'global')
      await provider.add('test')
      expect(mockRetain).toHaveBeenCalledWith('cherry', expect.any(String), expect.any(Object))
    })

    it('uses per_assistant strategy', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.memory.bank_strategy', 'per_assistant')
      await provider.add('test', { agentId: 'assistant-1' })
      expect(mockRetain).toHaveBeenCalledWith('cherry-agent-assistant-1', expect.any(String), expect.any(Object))
    })
  })

  describe('circuit breaker', () => {
    it('opens after 5 consecutive failures', async () => {
      mockRecall.mockRejectedValue(new Error('network error'))
      for (let i = 0; i < 5; i++) {
        await expect(provider.search('query')).rejects.toThrow()
      }
      // 6th call should fail with circuit breaker message
      await expect(provider.search('query')).rejects.toThrow('circuit breaker')
    })
  })
})
