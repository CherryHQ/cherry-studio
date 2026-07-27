import type { AiStreamOpenResponse } from '@shared/ai/transport'
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

describe('useConversationTurnController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ignores a stream-open acknowledgement from a previous scope', async () => {
    const pendingAck = createDeferred<AiStreamOpenResponse>()
    mocks.streamOpen.mockReturnValueOnce(pendingAck.promise)
    const historyAdapter: ConversationHistoryAdapter = {
      seedReservedMessages: vi.fn(),
      refresh: vi.fn(),
      rollback: vi.fn()
    }
    const { result, rerender } = renderHook(
      ({ scopeKey }: { scopeKey: string }) =>
        useConversationTurnController<string, { topicId: string }>({
          scopeKey,
          historyAdapter,
          ensureConversation: () => ({ topicId: scopeKey }),
          buildStreamRequest: (_input, conversation) => ({
            trigger: 'submit-message',
            topicId: conversation.topicId,
            userMessageParts: []
          })
        }),
      { initialProps: { scopeKey: 'agent-session:a' } }
    )

    let sendFromA!: Promise<AiStreamOpenResponse | null>
    act(() => {
      sendFromA = result.current.send('from A')
    })
    await waitFor(() => expect(mocks.streamOpen).toHaveBeenCalledOnce())

    rerender({ scopeKey: 'agent-session:b' })
    await act(async () => {
      pendingAck.resolve({ mode: 'started', reservedMessages: [] })
      await sendFromA
    })

    expect(result.current.localSendGeneration).toBe(0)
    expect(result.current.phase).toBe('draft')

    mocks.streamOpen.mockResolvedValueOnce({ mode: 'started', reservedMessages: [] })
    await act(async () => {
      await result.current.send('from B')
    })

    expect(result.current.localSendGeneration).toBe(1)
    expect(result.current.phase).toBe('streaming')
  })
})
