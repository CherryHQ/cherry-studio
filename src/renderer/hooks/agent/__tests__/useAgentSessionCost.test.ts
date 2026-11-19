import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@renderer/data/CacheService'
import { createSWRTestWrapper, installCacheApiMock } from '@renderer/data/hooks/__tests__/testUtils'
import { AGENT_SESSION_COST_CACHE_KEY } from '@shared/ai/agentSessionCost'

import { useAgentSessionCost } from '../useAgentSessionCost'

vi.unmock('@data/hooks/useDataApi')
vi.unmock('@data/hooks/useCache')
vi.unmock('@data/CacheService')

const sessionId = 'cost-test'
const key = AGENT_SESSION_COST_CACHE_KEY(sessionId)

beforeEach(() => {
  installCacheApiMock()
  cacheService.deleteShared(key)
})
afterEach(() => {
  cacheService.deleteShared(key)
  MockDataApiUtils.resetMocks()
  vi.restoreAllMocks()
})

describe('useAgentSessionCost', () => {
  it('restores history, prefers live zero and hides the previous native session cost after reconnection', async () => {
    MockDataApiUtils.setCustomResponse(`/agent-sessions/${sessionId}/cost`, 'GET', {
      nativeSessionId: 'native',
      reportedAt: 1,
      cost: { amount: 0.5, currency: 'EUR' }
    })
    const { Wrapper } = createSWRTestWrapper()
    const initialProps: { id: string | undefined } = { id: sessionId }
    const { result, rerender } = renderHook(({ id }) => useAgentSessionCost(id), {
      initialProps,
      wrapper: Wrapper
    })
    await waitFor(() => expect(result.current).toEqual({ amount: 0.5, currency: 'EUR' }))
    MockDataApiUtils.setCustomResponse(`/agent-sessions/${sessionId}/cost`, 'GET', {
      nativeSessionId: 'native',
      reportedAt: 2,
      cost: { amount: 0.4, currency: 'EUR' }
    })
    act(() =>
      MockDataApiUtils.emitDataChange([{ endpoint: '/agent-sessions/:sessionId/cost', routeParams: { sessionId } }])
    )
    await waitFor(() => expect(result.current).toEqual({ amount: 0.4, currency: 'EUR' }))
    act(() =>
      cacheService.setShared(key, { nativeSessionId: 'native', reportedAt: 2, cost: { amount: 0, currency: 'CNY' } })
    )
    expect(result.current).toEqual({ amount: 0, currency: 'CNY' })
    act(() => cacheService.setShared(key, { nativeSessionId: 'new-native', reportedAt: 3, cost: null }))
    expect(result.current).toBeNull()
    rerender({ id: undefined })
    expect(result.current).toBeNull()
    rerender({ id: 'other-session' })
    expect(result.current).toBeNull()
  })
})
