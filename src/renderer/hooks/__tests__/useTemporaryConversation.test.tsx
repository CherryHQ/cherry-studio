import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  dataApiDelete: vi.fn(),
  dataApiPatch: vi.fn(),
  dataApiPost: vi.fn()
}))

vi.mock('@data/CacheService', () => ({
  cacheService: {
    get: mocks.cacheGet,
    set: mocks.cacheSet
  }
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    delete: mocks.dataApiDelete,
    patch: mocks.dataApiPatch,
    post: mocks.dataApiPost
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn()
    })
  }
}))

import { useTemporaryConversation } from '../useTemporaryConversation'

describe('useTemporaryConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cacheGet.mockReturnValue(null)
    mocks.dataApiDelete.mockResolvedValue(undefined)
    mocks.dataApiPatch.mockResolvedValue(undefined)
  })

  it('keeps the current temporary conversation visible while replacing it', async () => {
    const { result } = renderHook(() => useTemporaryConversation({ type: 'assistant' }))

    mocks.dataApiPost.mockResolvedValueOnce({
      id: 'temp-topic-1',
      messages: []
    })

    await act(async () => {
      await result.current.start({ assistantId: 'assistant-1' })
    })

    expect(result.current.conversation).toMatchObject({
      type: 'assistant',
      topicId: 'temp-topic-1',
      assistantId: 'assistant-1'
    })
    expect(result.current.phase).toBe('leased')
    expect(result.current.persistedConversation).toBeNull()

    let resolveNextTopic!: (value: { id: string; messages: [] }) => void
    mocks.dataApiPost.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNextTopic = resolve
      })
    )

    let replacePromise!: Promise<unknown>
    act(() => {
      replacePromise = result.current.replace({ assistantId: 'assistant-2' })
    })

    expect(result.current.conversation).toMatchObject({
      type: 'assistant',
      topicId: 'temp-topic-1',
      assistantId: 'assistant-1'
    })
    expect(mocks.dataApiDelete).not.toHaveBeenCalled()

    await act(async () => {
      resolveNextTopic({ id: 'temp-topic-2', messages: [] })
      await replacePromise
    })

    expect(result.current.conversation).toMatchObject({
      type: 'assistant',
      topicId: 'temp-topic-2',
      assistantId: 'assistant-2'
    })
    expect(mocks.dataApiDelete).toHaveBeenCalledWith('/temporary/topics/temp-topic-1')
  })

  it('updates a temporary assistant conversation in place', async () => {
    const { result } = renderHook(() => useTemporaryConversation({ type: 'assistant' }))

    mocks.dataApiPost.mockResolvedValueOnce({
      id: 'temp-topic-1',
      messages: []
    })

    await act(async () => {
      await result.current.start({ assistantId: 'assistant-1' })
    })

    mocks.dataApiPatch.mockResolvedValueOnce({
      id: 'temp-topic-1',
      assistantId: 'assistant-2',
      messages: []
    })

    await act(async () => {
      await result.current.updateAssistant('assistant-2')
    })

    expect(mocks.dataApiPatch).toHaveBeenCalledWith('/temporary/topics/temp-topic-1', {
      body: { assistantId: 'assistant-2' }
    })
    expect(mocks.dataApiDelete).not.toHaveBeenCalled()
    expect(result.current.conversation).toMatchObject({
      type: 'assistant',
      topicId: 'temp-topic-1',
      assistantId: 'assistant-2'
    })
  })

  it('clears a temporary agent conversation after persisting it', async () => {
    const { result } = renderHook(() => useTemporaryConversation({ type: 'agent' }))

    mocks.dataApiPost.mockResolvedValueOnce({
      id: 'temp-session-1',
      agentId: 'agent-1',
      name: 'Draft'
    })

    await act(async () => {
      await result.current.start({ agentId: 'agent-1', name: 'Draft' })
    })

    expect(result.current.conversation).toMatchObject({
      type: 'agent',
      sessionId: 'temp-session-1',
      agentId: 'agent-1'
    })

    mocks.dataApiPost.mockResolvedValueOnce({
      id: 'temp-session-1',
      agentId: 'agent-1',
      name: 'Persisted'
    })

    let persisted: unknown
    await act(async () => {
      persisted = await result.current.persist()
    })

    expect(mocks.dataApiPost).toHaveBeenCalledWith('/temporary/sessions/temp-session-1/persist', { body: {} })
    expect(persisted).toMatchObject({
      type: 'agent',
      sessionId: 'temp-session-1',
      agentId: 'agent-1',
      name: 'Persisted'
    })
    expect(result.current.conversation).toBeNull()
    expect(result.current.persistedConversation).toMatchObject({
      type: 'agent',
      sessionId: 'temp-session-1',
      agentId: 'agent-1',
      name: 'Persisted'
    })
    expect(result.current.phase).toBe('persisted')
  })

  it('clears persisted handoff snapshot when starting another conversation', async () => {
    const { result } = renderHook(() => useTemporaryConversation({ type: 'agent' }))

    mocks.dataApiPost.mockResolvedValueOnce({
      id: 'temp-session-1',
      agentId: 'agent-1',
      name: 'Draft'
    })

    await act(async () => {
      await result.current.start({ agentId: 'agent-1', name: 'Draft' })
    })

    mocks.dataApiPost.mockResolvedValueOnce({
      id: 'temp-session-1',
      agentId: 'agent-1',
      name: 'Persisted'
    })

    await act(async () => {
      await result.current.persist()
    })

    mocks.dataApiPost.mockResolvedValueOnce({
      id: 'temp-session-2',
      agentId: 'agent-1',
      name: 'Draft 2'
    })

    await act(async () => {
      await result.current.start({ agentId: 'agent-1', name: 'Draft 2' })
    })

    expect(result.current.persistedConversation).toBeNull()
    expect(result.current.phase).toBe('leased')
    expect(result.current.conversation).toMatchObject({ id: 'temp-session-2' })
  })

  it('releases a temporary assistant topic when start resolves after unmount', async () => {
    let resolveTopic!: (value: { id: string; assistantId: string; messages: [] }) => void
    mocks.dataApiPost.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTopic = resolve
      })
    )

    const { result, unmount } = renderHook(() => useTemporaryConversation({ type: 'assistant' }))

    let startPromise!: Promise<unknown>
    act(() => {
      startPromise = result.current.start({ assistantId: 'assistant-1' })
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.dataApiPost).toHaveBeenCalledWith('/temporary/topics', { body: { assistantId: 'assistant-1' } })

    act(() => {
      unmount()
    })

    await act(async () => {
      resolveTopic({ id: 'temp-topic-race', assistantId: 'assistant-1', messages: [] })
      await startPromise
    })

    expect(mocks.dataApiDelete).toHaveBeenCalledWith('/temporary/topics/temp-topic-race')
  })

  it('releases a temporary agent session when start resolves after unmount', async () => {
    let resolveSession!: (value: { id: string; agentId: string; name: string }) => void
    mocks.dataApiPost.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSession = resolve
      })
    )

    const { result, unmount } = renderHook(() => useTemporaryConversation({ type: 'agent' }))

    let startPromise!: Promise<unknown>
    act(() => {
      startPromise = result.current.start({ agentId: 'agent-1', name: 'Agent 1' })
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.dataApiPost).toHaveBeenCalledWith('/temporary/sessions', {
      body: { agentId: 'agent-1', name: 'Agent 1', workspaceId: undefined }
    })

    act(() => {
      unmount()
    })

    await act(async () => {
      resolveSession({ id: 'temp-session-race', agentId: 'agent-1', name: 'Agent 1' })
      await startPromise
    })

    expect(mocks.dataApiDelete).toHaveBeenCalledWith('/temporary/sessions/temp-session-race')
  })
})
