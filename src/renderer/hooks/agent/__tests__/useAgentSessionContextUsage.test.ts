import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import { AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY } from '@shared/ai/agentSessionContextUsage'
import type { Model } from '@shared/data/types/model'

import { useAgentSessionContextUsage } from '../useAgentSessionContextUsage'

vi.unmock('@data/CacheService')
vi.unmock('@data/hooks/useCache')

const SESSION_ID = 'session-context-usage-test'
const KEY = AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(SESSION_ID)

const model = (id: string, contextWindow: number): Model => ({ id, contextWindow }) as Model

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { cache: { broadcastSync: vi.fn(), onSync: vi.fn(), getAllShared: vi.fn(async () => ({})) } }
  })
  cacheService.deleteShared(KEY)
  cacheService.setShared(KEY, {
    modelId: 'openai::small-model',
    result: {
      status: 'confirmed',
      value: {
        model: 'small-model',
        revision: 'r1',
        contextWindow: 250_000,
        used: { tokens: 200_000, precision: 'reported' },
        basis: 'current-context'
      }
    }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useAgentSessionContextUsage', () => {
  it('drops a reading published by a different model', () => {
    const { result } = renderHook(() => useAgentSessionContextUsage(SESSION_ID, model('openai::big-model', 1_000_000)))

    // Keeping it would render 200,000 / 1,000,000 (20%) for a session that was at 80%.
    expect(result.current.usage).toBeNull()
    expect(result.current.percentage).toBeNull()
  })

  it('uses the harness window even when the catalog disagrees', () => {
    const { result } = renderHook(() =>
      useAgentSessionContextUsage(SESSION_ID, model('openai::small-model', 1_000_000))
    )
    expect(result.current.maxTokens).toBe(250_000)
    expect(result.current.percentage).toBe(80)
  })

  it('preserves unknown occupancy instead of showing zero', () => {
    cacheService.setShared(KEY, {
      modelId: 'openai::small-model',
      result: {
        status: 'confirmed',
        value: { model: 'small-model', revision: 'after-compact', contextWindow: 250_000, basis: 'current-context' }
      }
    })
    const { result } = renderHook(() => useAgentSessionContextUsage(SESSION_ID, model('openai::small-model', 250_000)))
    expect(result.current.percentage).toBeNull()
    expect(result.current.maxTokens).toBe(250_000)
  })

  it('hides an unavailable native reading', () => {
    cacheService.setShared(KEY, {
      modelId: 'openai::small-model',
      result: {
        status: 'unsupported',
        error: { operation: 'contextUsage', code: 'child', message: 'Unsupported child access' }
      }
    })
    const { result } = renderHook(() => useAgentSessionContextUsage(SESSION_ID))
    expect(result.current.usage).toBeNull()
    expect(result.current.percentage).toBeNull()
  })
})
