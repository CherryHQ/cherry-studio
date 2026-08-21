import {
  ConversationKind,
  type ConversationRef,
  conversationRefKey,
  toConversationExecutionId,
  toConversationTurnId
} from '@shared/ai/conversation'
import type { ConversationExecutionProjection } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => {
  const finishListeners = new Map<string, (executionId: string, event: unknown) => void>()
  const refreshPorts = new Map<string, () => Promise<unknown>>()
  const emptyView = {
    overlay: {},
    liveAssistants: [],
    records: [],
    optimisticMessages: [],
    projectedExecutions: [],
    activeNodeOverride: null,
    refreshError: null
  }
  return {
    finishListeners,
    refreshPorts,
    service: {
      acquire: vi.fn(),
      release: vi.fn(),
      syncExecutions: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      getView: vi.fn(() => emptyView),
      seedReservations: vi.fn(),
      disposeOverlay: vi.fn(),
      reset: vi.fn(),
      clear: vi.fn(),
      onFinish: vi.fn((conversation: ConversationRef, listener: (executionId: string, event: unknown) => void) => {
        const key = conversationRefKey(conversation)
        finishListeners.set(key, listener)
        return () => finishListeners.delete(key)
      }),
      registerRefreshPort: vi.fn((conversation: ConversationRef, refresh: () => Promise<unknown>) => {
        const key = conversationRefKey(conversation)
        refreshPorts.set(key, refresh)
        return () => refreshPorts.delete(key)
      })
    }
  }
})

vi.mock('@renderer/services/aiTransport', () => ({ executionStreamOverlayService: mock.service }))

import { useExecutionOverlay } from '../useExecutionOverlay'

const modelId = 'openai::gpt-4o' as UniqueModelId
const conversation = (id: string): ConversationRef => ({ kind: ConversationKind.Chat, id })
const execution = (turn: string, id: string): ConversationExecutionProjection => ({
  turnId: toConversationTurnId(turn),
  executionId: toConversationExecutionId(id),
  modelId,
  outputNodeId: `assistant-${id}`
})
const assistant = (id: string): CherryUIMessage => ({ id, role: 'assistant', parts: [] }) as CherryUIMessage

describe('useExecutionOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock.finishListeners.clear()
    mock.refreshPorts.clear()
  })

  it('rebinds acquisition, execution contribution, and cleanup to the exact conversation', () => {
    const conversationA = conversation('a')
    const conversationB = conversation('b')
    const executionA = execution('turn-a', 'execution-a')
    const executionB = execution('turn-b', 'execution-b')
    const { rerender } = renderHook(({ ref, executions, messages }) => useExecutionOverlay(ref, executions, messages), {
      initialProps: { ref: conversationA, executions: [executionA], messages: [assistant('assistant-a')] }
    })

    const consumerA = mock.service.syncExecutions.mock.calls[0]?.[1]
    rerender({ ref: conversationB, executions: [executionB], messages: [assistant('assistant-b')] })
    const consumerB = mock.service.syncExecutions.mock.calls.at(-1)?.[1]

    expect(mock.service.acquire).toHaveBeenCalledWith(conversationA)
    expect(mock.service.acquire).toHaveBeenCalledWith(conversationB)
    expect(mock.service.release).toHaveBeenCalledWith(conversationA, consumerA)
    expect(consumerB).not.toBe(consumerA)
    expect(mock.service.syncExecutions).toHaveBeenLastCalledWith(
      conversationB,
      consumerB,
      [executionB],
      expect.any(Function)
    )
  })

  it('keeps stale finish and refresh callbacks bound to conversation A after rendering B', async () => {
    const conversationA = conversation('a')
    const conversationB = conversation('b')
    const onFinishA = vi.fn()
    const onFinishB = vi.fn()
    const refreshA = vi.fn(async () => undefined)
    const refreshB = vi.fn(async () => undefined)
    const { rerender } = renderHook(
      ({ ref, onFinish, refresh }) => useExecutionOverlay(ref, [], [], { onFinish, refreshOnQuiesced: refresh }),
      { initialProps: { ref: conversationA, onFinish: onFinishA, refresh: refreshA } }
    )
    const staleFinish = mock.finishListeners.get(conversationRefKey(conversationA))!
    const staleRefresh = mock.refreshPorts.get(conversationRefKey(conversationA))!

    rerender({ ref: conversationB, onFinish: onFinishB, refresh: refreshB })
    const finishEvent = {
      turnId: toConversationTurnId('turn-a'),
      executionId: toConversationExecutionId('execution-a'),
      message: assistant('assistant-a'),
      isAbort: false,
      isError: false
    }
    act(() => staleFinish(finishEvent.executionId, finishEvent))
    await staleRefresh()

    expect(onFinishA).toHaveBeenCalledWith(finishEvent.executionId, finishEvent)
    expect(refreshA).toHaveBeenCalledTimes(1)
    expect(onFinishB).not.toHaveBeenCalled()
    expect(refreshB).not.toHaveBeenCalled()
  })

  it('keeps API methods captured before a conversation switch bound to the old conversation', () => {
    const conversationA = conversation('a')
    const conversationB = conversation('b')
    const { result, rerender } = renderHook(({ ref }) => useExecutionOverlay(ref, [], []), {
      initialProps: { ref: conversationA }
    })
    const apiA = result.current

    rerender({ ref: conversationB })
    act(() => {
      apiA.disposeOverlay('assistant-a')
      apiA.reset()
      apiA.clear()
    })

    expect(mock.service.disposeOverlay).toHaveBeenCalledWith(conversationA, 'assistant-a')
    expect(mock.service.reset).toHaveBeenCalledWith(conversationA)
    expect(mock.service.clear).toHaveBeenCalledWith(conversationA)
    expect(mock.service.clear).not.toHaveBeenCalledWith(conversationB)
  })
})
