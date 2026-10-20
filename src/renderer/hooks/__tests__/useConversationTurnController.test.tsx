import { act, renderHook, waitFor } from '@testing-library/react'
import { useState } from 'react'
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

  it('a blocked automatic send must not toast when the caller owns the notice', async () => {
    mocks.streamOpen.mockResolvedValueOnce({
      mode: 'blocked',
      reason: 'agent-session-workspace',
      message: 'Workspace access is required'
    })
    const { result } = renderController()

    await act(async () => {
      expect(await result.current.send('queued message', { notifyFailure: false })).toBe(false)
    })

    expect(result.current.phase).toBe('ready')
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'rolls back a rejected automatic send without invoking onError (callback: %s)',
    async (hasCallback) => {
      const failure = new Error('stream open failed')
      mocks.streamOpen.mockRejectedValueOnce(failure)
      const pendingRollback = createDeferred<void>()
      const onError = vi.fn()
      const originalHistory = ['A', 'answer A']
      const { result } = renderHook(() => {
        const [history, setHistory] = useState(originalHistory)
        const controller = useConversationTurnController<string, { topicId: string }>({
          scopeKey: 'topic-a',
          ensureConversation: (input) => {
            setHistory([...originalHistory, input])
            return { topicId: 'topic-a' }
          },
          buildStreamRequest: () => ({ trigger: 'submit-message', topicId: 'topic-a', userMessageParts: [] }),
          historyAdapter: {
            seedReservedMessages: () => {},
            refresh: () => {},
            rollback: async () => {
              await pendingRollback.promise
              setHistory(originalHistory)
            }
          },
          onError: hasCallback ? onError : undefined
        })
        return { ...controller, history }
      })
      let settled = false
      let sending!: Promise<boolean>
      act(() => {
        sending = result.current.send('B', { notifyFailure: false }).then((sent) => {
          settled = true
          return sent
        })
      })
      await waitFor(() => expect(result.current.phase).toBe('opening'))
      expect(result.current.history).toEqual(['A', 'answer A', 'B'])
      expect(settled).toBe(false)
      await act(async () => {
        pendingRollback.resolve()
        expect(await sending).toBe(false)
      })
      expect(result.current.history).toEqual(originalHistory)
      expect(result.current.phase).toBe('draft')
      expect(onError).not.toHaveBeenCalled()
      expect(mocks.toastError).not.toHaveBeenCalled()
    }
  )

  it.each([false, true])(
    'preserves the original rejection with throwOnError despite notification suppression (rollback fails: %s)',
    async (rollbackFails) => {
      const failure = new Error('stream open failed')
      mocks.streamOpen.mockRejectedValueOnce(failure)
      const onError = vi.fn()
      const { result, historyAdapter } = renderController('topic-a', onError)
      const rollback = createDeferred<void>()
      vi.mocked(historyAdapter.rollback).mockImplementation(async () => {
        await rollback.promise
        if (rollbackFails) throw new Error('rollback failed')
      })
      let sending!: Promise<void>
      act(() => {
        sending = expect(result.current.send('B', { notifyFailure: false, throwOnError: true })).rejects.toBe(failure)
      })
      await waitFor(() => expect(historyAdapter.rollback).toHaveBeenCalledOnce())
      await act(async () => {
        rollback.resolve()
        await sending
      })
      expect(result.current.phase).toBe('draft')
      expect(onError).not.toHaveBeenCalled()
      expect(mocks.loggerWarn).toHaveBeenCalledTimes(rollbackFails ? 1 : 0)
    }
  )

  it.each([undefined, true])(
    'preserves ordinary rejection feedback and default propagation (notifyFailure: %s)',
    async (notifyFailure) => {
      const failure = new Error('stream open failed')
      const onError = vi.fn()
      const withCallback = renderController('topic-a', onError)
      mocks.streamOpen.mockRejectedValueOnce(failure)
      await act(async () => {
        expect(await withCallback.result.current.send('B', { notifyFailure })).toBe(false)
      })
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure, 'B')
      expect(withCallback.result.current.phase).toBe('draft')
      withCallback.unmount()
      const withoutCallback = renderController()
      mocks.streamOpen.mockRejectedValueOnce(failure)
      await act(async () => {
        await expect(withoutCallback.result.current.send('B', { notifyFailure })).rejects.toBe(failure)
      })
      expect(withoutCallback.result.current.phase).toBe('draft')
    }
  )

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
