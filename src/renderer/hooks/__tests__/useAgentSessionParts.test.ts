import type { AgentSessionMessageEntity } from '@shared/data/types/agent'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dataApiMocks = vi.hoisted(() => ({
  useInfiniteFlatItems: vi.fn(),
  useInfiniteQuery: vi.fn(),
  useMutation: vi.fn()
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useInfiniteFlatItems: dataApiMocks.useInfiniteFlatItems,
  useInfiniteQuery: dataApiMocks.useInfiniteQuery,
  useMutation: dataApiMocks.useMutation
}))

const { toAgentSessionUIMessage, useAgentSessionParts } = await import('../useAgentSessionParts')

function mockAgentSessionPartsDataApi(pages: Array<{ items: AgentSessionMessageEntity[]; nextCursor?: string }> = []) {
  dataApiMocks.useInfiniteQuery.mockReturnValue({
    pages,
    isLoading: false,
    isRefreshing: false,
    hasNext: false,
    loadNext: vi.fn(),
    mutate: vi.fn()
  })
  dataApiMocks.useInfiniteFlatItems.mockReturnValue(pages.flatMap((page) => page.items))
  dataApiMocks.useMutation.mockReturnValue({ trigger: vi.fn() })
}

describe('toAgentSessionUIMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAgentSessionPartsDataApi()
  })

  it('projects the flattened agent session message row from data.parts', () => {
    const row = {
      id: 'message-1',
      sessionId: 'session-1',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'from parts' }] },
      searchableText: 'from parts',
      status: 'success',
      modelId: 'anthropic::claude',
      modelSnapshot: { id: 'claude', name: 'Claude', provider: 'anthropic' },
      stats: { totalTokens: 10 },
      runtimeResumeToken: 'agent-session-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z'
    } as AgentSessionMessageEntity

    expect(toAgentSessionUIMessage(row)).toMatchObject({
      id: 'message-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'from parts' }],
      metadata: {
        createdAt: '2026-01-01T00:00:00.000Z',
        status: 'success',
        modelId: 'anthropic::claude',
        modelSnapshot: { id: 'claude', name: 'Claude', provider: 'anthropic' },
        stats: { totalTokens: 10 }
      }
    })
  })
})

describe('useAgentSessionParts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAgentSessionPartsDataApi()
  })

  it('can suppress mount revalidation during a temporary handoff', () => {
    renderHook(() => useAgentSessionParts('session-1', { enabled: true, fetchOnMount: false }))

    expect(dataApiMocks.useInfiniteQuery).toHaveBeenCalledWith(
      '/agent-sessions/:sessionId/messages',
      expect.objectContaining({
        params: { sessionId: 'session-1' },
        swrOptions: expect.objectContaining({
          revalidateIfStale: false,
          revalidateOnMount: false
        })
      })
    )
  })
})
