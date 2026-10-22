import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiStreamOpenResponse } from '@shared/ai/transport'

import { type ConversationHistoryAdapter, useConversationTurnController } from '../useConversationTurnController'

const mocks = vi.hoisted(() => ({
  streamOpen: vi.fn(),
  toastError: vi.fn(),
  loggerWarn: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: unknown[]) => mocks.streamOpen(...args)
  }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: {
    error: mocks.toastError
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: mocks.loggerWarn
    })
  }
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function renderController(initialScopeKey = 'topic-a', onError?: (error: unknown, input: string) => void) {
  const refreshMetadata = vi.fn()
  const historyAdapter: ConversationHistoryAdapter = {
    seedReservedMessages: vi.fn(),
    refresh: vi.fn(),
    rollback: vi.fn()
  }
  const view = renderHook(
    ({ scopeKey }: { scopeKey: string }) =>
      useConversationTurnController<string, { topicId: string }>({
        scopeKey,
        historyAdapter,
        ensureConversation: () => ({ topicId: scopeKey }),
        buildStreamRequest: (_input, conversation) => ({
          trigger: 'submit-message',
          topicId: conversation.topicId,
          userMessageParts: []
        }),
        refreshMetadata,
        onError
      }),
    { initialProps: { scopeKey: initialScopeKey } }
  )

  return { ...view, historyAdapter, refreshMetadata }
}

describe('useConversationTurnController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ignores a stream-open acknowledgement from a previous scope', async () => {
    const pendingAck = createDeferred<AiStreamOpenResponse>()
    mocks.streamOpen.mockReturnValueOnce(pendingAck.promise)
    const { result, rerender, historyAdapter, refreshMetadata } = renderController('agent-session:a')

    let sendFromA!: Promise<boolean>
    act(() => {
      sendFromA = result.current.send('from A')
    })
    await waitFor(() => expect(mocks.streamOpen).toHaveBeenCalledOnce())

    rerender({ scopeKey: 'agent-session:b' })
    await act(async () => {
      pendingAck.resolve({
        mode: 'started',
        reservedMessages: [{ id: 'assistant-a', role: 'assistant', parts: [] }]
      })
      await sendFromA
    })

    expect(result.current.phase).toBe('draft')
    expect(historyAdapter.seedReservedMessages).not.toHaveBeenCalled()
    expect(refreshMetadata).toHaveBeenCalledWith(
      { topicId: 'agent-session:a' },
      expect.objectContaining({ mode: 'started' })
    )

    mocks.streamOpen.mockResolvedValueOnce({ mode: 'started', reservedMessages: [] })
    let sentFromB: boolean | undefined
    await act(async () => {
      sentFromB = await result.current.send('from B')
    })

    expect(sentFromB).toBe(true)
    expect(result.current.phase).toBe('streaming')
  })

  it.each([false, true])(
    'returns to ready when stream open is blocked (caller owns errors: %s)',
    async (throwOnError) => {
      mocks.streamOpen.mockResolvedValueOnce({
        mode: 'blocked',
        reason: 'agent-session-workspace',
        message: 'Workspace access is required'
      })
      const onError = vi.fn()
      const { result, historyAdapter } = renderController('topic-a', onError)

      let sent: boolean | undefined
      await act(async () => {
        const request = result.current.send('blocked message', { throwOnError })
        if (throwOnError) await expect(request).rejects.toThrow('Workspace access is required')
        else sent = await request
      })

      if (!throwOnError) expect(sent).toBe(false)
      expect(result.current.phase).toBe('ready')
      if (throwOnError) expect(mocks.toastError).not.toHaveBeenCalled()
      else expect(mocks.toastError).toHaveBeenCalledWith('Workspace access is required')
      expect(onError).not.toHaveBeenCalled()
      expect(historyAdapter.seedReservedMessages).not.toHaveBeenCalled()
      expect(historyAdapter.rollback).not.toHaveBeenCalled()
    }
  )

  it('returns to draft when stream open fails', async () => {
    mocks.streamOpen.mockRejectedValueOnce(new Error('stream open failed'))
    const { result, historyAdapter } = renderController()

    await act(async () => {
      await expect(result.current.send('failed message')).rejects.toThrow('stream open failed')
    })

    expect(result.current.phase).toBe('draft')
    expect(historyAdapter.seedReservedMessages).not.toHaveBeenCalled()
    expect(historyAdapter.rollback).toHaveBeenCalledOnce()
  })

  it('does not surface a stream-open failure after switching scopes', async () => {
    const pendingAck = createDeferred<AiStreamOpenResponse>()
    mocks.streamOpen.mockReturnValueOnce(pendingAck.promise)
    const onError = vi.fn()
    const { result, rerender, historyAdapter } = renderController('agent-session:a', onError)

    let sendFromA!: Promise<boolean>
    act(() => {
      sendFromA = result.current.send('from A')
    })
    await waitFor(() => expect(mocks.streamOpen).toHaveBeenCalledOnce())
    rerender({ scopeKey: 'agent-session:b' })

    await act(async () => {
      pendingAck.reject(new Error('old session failed'))
      expect(await sendFromA).toBe(false)
    })

    expect(result.current.phase).toBe('draft')
    expect(historyAdapter.rollback).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it.each([false, true])('keeps the new scope intact during rollback (rollback fails: %s)', async (rollbackFails) => {
    const failure = new Error('old session failed')
    mocks.streamOpen.mockRejectedValueOnce(failure)
    const pendingRollback = createDeferred<void>()
    const onError = vi.fn()
    const { result, rerender, historyAdapter } = renderController('agent-session:a', onError)
    vi.mocked(historyAdapter.rollback).mockImplementation(async () => {
      await pendingRollback.promise
      if (rollbackFails) throw new Error('rollback failed')
    })

    let sendFromA!: Promise<boolean>
    act(() => {
      sendFromA = result.current.send('from A')
    })
    await waitFor(() => expect(historyAdapter.rollback).toHaveBeenCalledOnce())
    rerender({ scopeKey: 'agent-session:b' })

    mocks.streamOpen.mockResolvedValueOnce({ mode: 'started', reservedMessages: [] })
    await act(async () => {
      expect(await result.current.send('from B')).toBe(true)
    })
    expect(result.current.phase).toBe('streaming')

    await act(async () => {
      pendingRollback.resolve()
      expect(await sendFromA).toBe(false)
    })
    expect(result.current.phase).toBe('streaming')
    expect(onError).not.toHaveBeenCalled()
  })
})
