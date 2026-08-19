import {
  ConversationBlockReason,
  ConversationKind,
  ConversationOpenMode,
  ConversationOpenTrigger
} from '@shared/ai/conversation'
import type { AiStreamOpenResponse } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function renderController(initialScopeKey = 'topic-a') {
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
          trigger: ConversationOpenTrigger.SubmitMessage,
          conversation: { kind: ConversationKind.Chat, id: conversation.topicId },
          userMessageParts: []
        }),
        refreshMetadata
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
    const { result, rerender, historyAdapter, refreshMetadata } = renderController('agent:a')

    let sendFromA!: Promise<AiStreamOpenResponse | null>
    act(() => {
      sendFromA = result.current.send('from A')
    })
    await waitFor(() => expect(mocks.streamOpen).toHaveBeenCalledOnce())

    rerender({ scopeKey: 'agent:b' })
    await act(async () => {
      pendingAck.resolve({
        mode: ConversationOpenMode.Started,
        reservedMessages: [{ id: 'assistant-a', role: 'assistant', parts: [] } as CherryUIMessage]
      })
      await sendFromA
    })

    expect(result.current.phase).toBe('draft')
    expect(historyAdapter.seedReservedMessages).not.toHaveBeenCalled()
    expect(refreshMetadata).toHaveBeenCalledWith(
      { topicId: 'agent:a' },
      expect.objectContaining({ mode: ConversationOpenMode.Started })
    )

    mocks.streamOpen.mockResolvedValueOnce({ mode: ConversationOpenMode.Started, reservedMessages: [] })
    await act(async () => {
      await result.current.send('from B')
    })

    expect(result.current.phase).toBe('streaming')
  })

  it('returns to ready when stream open is blocked', async () => {
    mocks.streamOpen.mockResolvedValueOnce({
      mode: ConversationOpenMode.Blocked,
      reason: ConversationBlockReason.AgentSessionWorkspace,
      message: 'Workspace access is required'
    })
    const { result, historyAdapter } = renderController()

    await act(async () => {
      await result.current.send('blocked message')
    })

    expect(result.current.phase).toBe('ready')
    expect(mocks.toastError).toHaveBeenCalledWith('Workspace access is required')
    expect(historyAdapter.seedReservedMessages).not.toHaveBeenCalled()
    expect(historyAdapter.rollback).not.toHaveBeenCalled()
  })

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
})
