/**
 * The usage cache survives reconnects, so an entry published by the previous model outlives a model
 * switch. The denominator now comes from the passed model rather than the payload, so an unfiltered
 * reading would divide the old model's tokens by the new model's window.
 */
import { cacheService } from '@data/CacheService'
import {
  AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY,
  type AgentSessionContextUsage
} from '@shared/ai/agentSessionContextUsage'
import type { Model } from '@shared/data/types/model'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  // 200,000 tokens reported by a small-window model.
  cacheService.setShared(KEY, {
    categories: [],
    totalTokens: 200_000,
    maxTokens: 250_000,
    percentage: 80,
    model: 'small-model'
  } as unknown as AgentSessionContextUsage)
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

  it('measures a matching reading against the model window, not the compaction budget', () => {
    const { result } = renderHook(() => useAgentSessionContextUsage(SESSION_ID, model('openai::small-model', 500_000)))

    expect(result.current.maxTokens).toBe(500_000)
    expect(result.current.percentage).toBe(40)
  })

  // An id `ModelSchema` should have rejected must neither unmount the pane nor silently disable
  // filtering — the reading belongs to another model either way.
  it('fails closed on a model id it cannot parse', () => {
    const { result } = renderHook(() => useAgentSessionContextUsage(SESSION_ID, model('provider:legacy', 500_000)))

    expect(result.current.usage).toBeNull()
  })

  it('falls back to the payload when the model declares no window', () => {
    const { result } = renderHook(() => useAgentSessionContextUsage(SESSION_ID, model('openai::small-model', 0)))

    expect(result.current.maxTokens).toBe(250_000)
    expect(result.current.percentage).toBe(80)
  })
})
