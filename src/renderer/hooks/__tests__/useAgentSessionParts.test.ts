import type { AgentSessionMessageEntity } from '@shared/data/types/agent'
import type { CherryMessagePart } from '@shared/data/types/message'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApi, MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dataApiMocks = MockUseDataApi

vi.mock('@renderer/data/hooks/useDataApi', async () => (await import('@test-mocks/renderer/useDataApi')).MockUseDataApi)
vi.mock('../useConversationHistoryQuery', async () => ({
  useConversationHistoryQuery: (await import('@test-mocks/renderer/useDataApi')).mockUseInfiniteQuery
}))

const { toAgentSessionUIMessage, useAgentSessionParts } = await import('../useAgentSessionParts')

function sessionMessageRow(id: string, sessionId = 'session-1'): AgentSessionMessageEntity {
  return {
    id,
    sessionId,
    role: 'user',
    data: { parts: [{ type: 'text', text: id }] },
    searchableText: id,
    status: 'success',
    modelId: null,
    messageSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  } as AgentSessionMessageEntity
}

function agentSessionHistoryQueryOptions(sessionId: string) {
  return { params: { sessionId }, query: { deferToolOutputs: true }, limit: 50 } as const
}

function mockAgentSessionPartsDataApi(pages: Array<{ items: AgentSessionMessageEntity[]; nextCursor?: string }> = []) {
  dataApiMocks.useInfiniteQuery.mockReturnValue({
    pages,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    hasNext: false,
    loadNext: vi.fn(),
    refresh: vi.fn(),
    reset: vi.fn(),
    mutate: vi.fn()
  })
  dataApiMocks.useMutation.mockReturnValue({ trigger: vi.fn(), isLoading: false, error: undefined })
}

function mockLiveAgentSessionParts(initialItems: AgentSessionMessageEntity[]) {
  type Pages = Array<{ items: AgentSessionMessageEntity[]; nextCursor?: string }>
  const trigger = vi.fn(async () => undefined)
  MockUseDataApiUtils.seedInfiniteQuery(
    '/agent-sessions/:sessionId/messages',
    [{ items: [...initialItems].reverse(), nextCursor: undefined }],
    agentSessionHistoryQueryOptions('session-1')
  )
  MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/agent-sessions/:sessionId/messages/:messageId', trigger)
  return {
    getIds: (sessionId = 'session-1') =>
      (
        MockUseDataApiUtils.getInfiniteQueryPages(
          '/agent-sessions/:sessionId/messages',
          agentSessionHistoryQueryOptions(sessionId)
        ) ?? []
      )
        .slice()
        .reverse()
        .flatMap((page) => [...page.items].reverse().map((item) => item.id)),
    setItems: (sessionId: string, items: AgentSessionMessageEntity[]) => {
      MockUseDataApiUtils.setInfiniteQueryPages(
        '/agent-sessions/:sessionId/messages',
        [{ items: [...items].reverse(), nextCursor: undefined }] as Pages,
        agentSessionHistoryQueryOptions(sessionId)
      )
    },
    trigger
  }
}

describe('toAgentSessionUIMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUseCacheUtils.resetMocks()
    MockUseDataApiUtils.resetMocks()
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
      messageSnapshot: {
        id: 'ag1',
        name: 'Agent',
        model: { id: 'claude', name: 'Claude', provider: 'anthropic' }
      },
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
        messageSnapshot: {
          id: 'ag1',
          name: 'Agent',
          model: { id: 'claude', name: 'Claude', provider: 'anthropic' }
        },
        stats: { totalTokens: 10 }
      }
    })
  })
})

describe('useAgentSessionParts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUseCacheUtils.resetMocks()
    MockUseDataApiUtils.resetMocks()
    mockAgentSessionPartsDataApi()
  })

  it('does not reuse messages from the previous session while the session key changes', () => {
    renderHook(() => useAgentSessionParts('session-1'))

    expect(dataApiMocks.useInfiniteQuery).toHaveBeenCalledWith(
      '/agent-sessions/:sessionId/messages',
      expect.objectContaining({
        params: { sessionId: 'session-1' },
        swrOptions: expect.objectContaining({
          keepPreviousData: false
        })
      })
    )
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

  it('refreshes mounted history when main persists a background approval interaction', () => {
    const mutate = vi.fn()
    dataApiMocks.useInfiniteQuery.mockReturnValue({
      pages: [],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      mutate
    })

    renderHook(() => useAgentSessionParts('session-1'))
    expect(dataApiMocks.useDataChange).toHaveBeenCalledWith(
      '/agent-sessions/:sessionId/messages',
      expect.any(Function),
      { routeParams: { sessionId: 'session-1' } }
    )

    const listener = dataApiMocks.useDataChange.mock.calls.at(-1)?.[1] as (() => void) | undefined
    listener?.()

    expect(mutate).toHaveBeenCalledOnce()
  })

  it('preserves unchanged message identities across revalidation and replaces updated rows', () => {
    const originalRow = {
      id: 'message-1',
      sessionId: 'session-1',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'original' }] },
      searchableText: 'original',
      status: 'success',
      modelId: null,
      messageSnapshot: null,
      stats: null,
      runtimeResumeToken: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z'
    } as AgentSessionMessageEntity
    mockAgentSessionPartsDataApi([{ items: [originalRow] }])

    const { result, rerender } = renderHook(() => useAgentSessionParts('session-1'))
    const originalMessage = result.current.messages[0]
    const revalidatedRow = {
      ...originalRow,
      data: { parts: [{ type: 'text', text: 'original' }] }
    } as AgentSessionMessageEntity
    mockAgentSessionPartsDataApi([{ items: [revalidatedRow] }])
    rerender()

    expect(result.current.messages[0]).toBe(originalMessage)

    const updatedRow = {
      ...revalidatedRow,
      data: { parts: [{ type: 'text', text: 'updated' }] },
      updatedAt: '2026-01-01T00:00:02.000Z'
    } as AgentSessionMessageEntity
    mockAgentSessionPartsDataApi([{ items: [updatedRow] }])
    rerender()

    expect(result.current.messages[0]).not.toBe(originalMessage)
    expect(result.current.messages[0].parts).toEqual([{ type: 'text', text: 'updated' }])
  })

  it('does not let a stale session refresh replace the current session projection cache', async () => {
    const rowFor = (sessionId: string, text: string): AgentSessionMessageEntity =>
      ({
        id: `message-${sessionId}`,
        sessionId,
        role: 'assistant',
        data: { parts: [{ type: 'text', text }] },
        searchableText: text,
        status: 'success',
        modelId: null,
        messageSnapshot: null,
        stats: null,
        runtimeResumeToken: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:01.000Z'
      }) as AgentSessionMessageEntity
    const sessionOneRow = rowFor('session-1', 'one')
    const sessionTwoRow = rowFor('session-2', 'two')
    let resolveSessionOneRefresh!: (pages: Array<{ items: AgentSessionMessageEntity[] }>) => void
    const sessionOneMutate = vi.fn(
      () =>
        new Promise<Array<{ items: AgentSessionMessageEntity[] }>>((resolve) => {
          resolveSessionOneRefresh = resolve
        })
    )
    const sessionTwoMutate = vi.fn()
    dataApiMocks.useInfiniteQuery.mockImplementation((_path, config) => {
      const sessionId = (config as { params?: { sessionId?: string } } | undefined)?.params?.sessionId
      const isSessionOne = sessionId === 'session-1'
      return {
        pages: [{ items: [isSessionOne ? sessionOneRow : sessionTwoRow] }],
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        hasNext: false,
        loadNext: vi.fn(),
        refresh: vi.fn(),
        reset: vi.fn(),
        mutate: isSessionOne ? sessionOneMutate : sessionTwoMutate
      }
    })

    const { result, rerender } = renderHook(({ sessionId }) => useAgentSessionParts(sessionId), {
      initialProps: { sessionId: 'session-1' }
    })
    let staleRefresh!: Promise<unknown>
    act(() => {
      staleRefresh = result.current.refresh()
    })

    rerender({ sessionId: 'session-2' })
    const sessionTwoMessage = result.current.messages[0]

    await act(async () => {
      resolveSessionOneRefresh([{ items: [rowFor('session-1', 'refreshed one')] }])
      await staleRefresh
    })
    rerender({ sessionId: 'session-2' })

    expect(result.current.messages[0]).toBe(sessionTwoMessage)
    expect(result.current.messages[0].id).toBe('message-session-2')
  })

  it('overlays live background-agent flow parts onto the original assistant row', () => {
    const row = {
      id: 'message-1',
      sessionId: 'session-1',
      role: 'assistant',
      data: {
        parts: [
          {
            type: 'tool-Agent',
            toolCallId: 'task-root',
            state: 'input-available',
            input: { prompt: 'Audit' }
          }
        ]
      },
      searchableText: '',
      status: 'success',
      modelId: null,
      messageSnapshot: null,
      stats: null,
      runtimeResumeToken: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    } as AgentSessionMessageEntity
    mockAgentSessionPartsDataApi([{ items: [row] }])
    MockUseCacheUtils.setSharedCacheValue('agent.session.flow_parts.session-1.message-1', [
      ...(row.data.parts ?? []),
      {
        type: 'text',
        text: 'Subagent finished',
        providerMetadata: { cherry: { parentToolCallId: 'task-root' } }
      }
    ])

    const { result } = renderHook(() => useAgentSessionParts('session-1'))

    expect(result.current.messages[0].parts).toEqual([
      expect.objectContaining({ toolCallId: 'task-root' }),
      expect.objectContaining({
        type: 'text',
        text: 'Subagent finished',
        providerMetadata: { cherry: { parentToolCallId: 'task-root' } }
      })
    ])
  })

  it('reprojects only the message whose live flow parts changed', () => {
    const rowFor = (id: string): AgentSessionMessageEntity =>
      ({
        id,
        sessionId: 'session-1',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: `Persisted ${id}` }] },
        searchableText: '',
        status: 'success',
        modelId: null,
        messageSnapshot: null,
        stats: null,
        runtimeResumeToken: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }) as AgentSessionMessageEntity
    const firstRow = rowFor('message-1')
    const secondRow = rowFor('message-2')
    mockAgentSessionPartsDataApi([{ items: [secondRow, firstRow] }])
    const firstLiveParts: CherryMessagePart[] = [{ type: 'text', text: 'First live' }]
    const secondLiveParts: CherryMessagePart[] = [{ type: 'text', text: 'Second live' }]
    MockUseCacheUtils.setSharedCacheValue('agent.session.flow_parts.session-1.message-1', firstLiveParts)
    MockUseCacheUtils.setSharedCacheValue('agent.session.flow_parts.session-1.message-2', secondLiveParts)

    const { result, rerender } = renderHook(() => useAgentSessionParts('session-1'))
    const originalFirstMessage = result.current.messages[0]
    const originalSecondMessage = result.current.messages[1]
    const updatedFirstParts: CherryMessagePart[] = [{ type: 'text', text: 'First live updated' }]

    MockUseCacheUtils.setSharedCacheValue('agent.session.flow_parts.session-1.message-1', updatedFirstParts)
    rerender()

    expect(result.current.messages[0]).not.toBe(originalFirstMessage)
    expect(result.current.messages[0].parts).toBe(updatedFirstParts)
    expect(result.current.messages[1]).toBe(originalSecondMessage)
    expect(result.current.messages[1].parts).toBe(secondLiveParts)
  })

  it('reads an existing flow overlay when its message row loads later', () => {
    const liveParts: CherryMessagePart[] = [{ type: 'text', text: 'Already streaming' }]
    MockUseCacheUtils.setSharedCacheValue('agent.session.flow_parts.session-1.message-1', liveParts)
    const { result, rerender } = renderHook(() => useAgentSessionParts('session-1'))
    expect(result.current.messages).toEqual([])

    const row = {
      id: 'message-1',
      sessionId: 'session-1',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'Persisted' }] },
      searchableText: '',
      status: 'success',
      modelId: null,
      messageSnapshot: null,
      stats: null,
      runtimeResumeToken: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    } as AgentSessionMessageEntity
    mockAgentSessionPartsDataApi([{ items: [row] }])
    rerender()

    expect(result.current.messages[0].parts).toBe(liveParts)
  })

  it('drops a successfully deleted message from the visible infinite list without remounting', async () => {
    const live = mockLiveAgentSessionParts([sessionMessageRow('message-keep'), sessionMessageRow('message-delete')])
    const { result } = renderHook(() => useAgentSessionParts('session-1'))

    expect(result.current.messages.map((message) => message.id)).toEqual(['message-keep', 'message-delete'])

    await act(async () => {
      await result.current.deleteMessage('message-delete')
    })

    expect(live.trigger).toHaveBeenCalledOnce()
    expect(live.trigger).toHaveBeenCalledWith({
      params: { sessionId: 'session-1', messageId: 'message-delete' }
    })
    expect(live.getIds()).toEqual(['message-keep'])
    expect(result.current.messages.map((message) => message.id)).toEqual(['message-keep'])
  })

  it('keeps the row in the visible list when DELETE fails', async () => {
    const live = mockLiveAgentSessionParts([sessionMessageRow('message-1')])
    live.trigger.mockRejectedValueOnce(new Error('delete failed'))
    const { result, rerender } = renderHook(() => useAgentSessionParts('session-1'))

    await expect(
      act(async () => {
        await result.current.deleteMessage('message-1')
      })
    ).rejects.toThrow('delete failed')
    rerender()

    expect(live.trigger).toHaveBeenCalledOnce()
    expect(live.getIds()).toEqual(['message-1'])
    expect(result.current.messages.map((message) => message.id)).toEqual(['message-1'])
  })

  it('does not send another DELETE for an id already removed from the local list', async () => {
    const live = mockLiveAgentSessionParts([sessionMessageRow('message-1'), sessionMessageRow('message-2')])
    const { result, rerender } = renderHook(() => useAgentSessionParts('session-1'))

    await act(async () => {
      await result.current.deleteMessage('message-1')
    })
    rerender()
    await act(async () => {
      await result.current.deleteMessage('message-1')
    })

    expect(live.trigger).toHaveBeenCalledOnce()
    expect(live.getIds()).toEqual(['message-2'])
  })

  it('allows a recreated message to be deleted after leaving and returning to its session', async () => {
    const live = mockLiveAgentSessionParts([sessionMessageRow('message-1')])
    live.setItems('session-2', [sessionMessageRow('message-2', 'session-2')])
    const { result, rerender } = renderHook(({ sessionId }) => useAgentSessionParts(sessionId), {
      initialProps: { sessionId: 'session-1' }
    })

    await act(async () => {
      await result.current.deleteMessage('message-1')
    })
    rerender({ sessionId: 'session-2' })
    live.setItems('session-1', [sessionMessageRow('message-1')])
    rerender({ sessionId: 'session-1' })
    await act(async () => {
      await result.current.deleteMessage('message-1')
    })

    expect(live.trigger).toHaveBeenCalledTimes(2)
    expect(live.trigger).toHaveBeenLastCalledWith({
      params: { sessionId: 'session-1', messageId: 'message-1' }
    })
  })

  it('does not send a second DELETE while the first request is in flight', async () => {
    const live = mockLiveAgentSessionParts([sessionMessageRow('message-1')])
    let resolveDelete!: () => void
    live.trigger.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDelete = () => resolve(undefined)
        })
    )
    const { result } = renderHook(() => useAgentSessionParts('session-1'))

    let firstDelete!: Promise<void>
    let duplicateDelete!: Promise<void>
    act(() => {
      firstDelete = result.current.deleteMessage('message-1')
      duplicateDelete = result.current.deleteMessage('message-1')
    })
    expect(live.trigger).toHaveBeenCalledOnce()
    await act(async () => {
      resolveDelete()
      await Promise.all([firstDelete, duplicateDelete])
    })

    expect(live.getIds()).toEqual([])
  })

  it('shares an in-flight DELETE failure with duplicate callers', async () => {
    const live = mockLiveAgentSessionParts([sessionMessageRow('message-1')])
    let rejectDelete!: (error: Error) => void
    live.trigger.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectDelete = reject
        })
    )
    const { result } = renderHook(() => useAgentSessionParts('session-1'))

    let firstDelete!: Promise<void>
    let duplicateDelete!: Promise<void>
    act(() => {
      firstDelete = result.current.deleteMessage('message-1')
      duplicateDelete = result.current.deleteMessage('message-1')
    })

    let outcomes!: PromiseSettledResult<void>[]
    await act(async () => {
      rejectDelete(new Error('delete failed'))
      outcomes = await Promise.allSettled([firstDelete, duplicateDelete])
    })

    expect(outcomes).toEqual([
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ message: 'delete failed' }) }),
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ message: 'delete failed' }) })
    ])
    expect(live.trigger).toHaveBeenCalledOnce()
    expect(live.getIds()).toEqual(['message-1'])
  })

  it('applies a late DELETE success to the session where deletion began', async () => {
    const live = mockLiveAgentSessionParts([sessionMessageRow('message-1')])
    live.setItems('session-2', [sessionMessageRow('message-2', 'session-2')])
    let resolveDelete!: () => void
    live.trigger.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolveDelete = () => resolve(undefined)
        })
    )

    const { result, rerender } = renderHook(({ sessionId }) => useAgentSessionParts(sessionId), {
      initialProps: { sessionId: 'session-1' }
    })
    let pendingDelete!: Promise<void>
    act(() => {
      pendingDelete = result.current.deleteMessage('message-1')
    })

    rerender({ sessionId: 'session-2' })
    await act(async () => {
      resolveDelete()
      await pendingDelete
    })

    expect(live.getIds('session-1')).toEqual([])
    expect(live.getIds('session-2')).toEqual(['message-2'])
  })
})
