import type { ExecutionFinishEvent } from '@renderer/hooks/useExecutionOverlay'
import type { Topic } from '@renderer/types/topic'
import { ConversationActiveNodeMove, type ConversationRef, conversationRefKey } from '@shared/ai/conversation'
import type { ActiveNodeDecision, ConversationExecutionProjection } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import { act, render } from '@testing-library/react'
import { Activity, useEffect, useMemo, useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  turnControllerConfig: null as any,
  onBranchLiveStateChange: vi.fn(),
  refresh: vi.fn(async () => [] as CherryUIMessage[]),
  seedMessagesCache: vi.fn(async () => undefined),
  rollbackBranch: vi.fn(),
  activeExecutions: [] as ConversationExecutionProjection[],
  overlayExecutions: [] as ConversationExecutionProjection[],
  liveMessageIds: [] as string[],
  liveAssistants: [] as CherryUIMessage[],
  overlayOnFinish: null as ((executionId: string, event: ExecutionFinishEvent) => void) | null,
  overlayRefreshOnQuiesced: null as (() => Promise<unknown>) | null
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useInvalidateCache: () => vi.fn()
}))

// The live-state builder is the guard's observable output surface: the test
// asserts on the topic/message ids it forwards to onBranchLiveStateChange.
vi.mock('@renderer/components/chat/flow/topicMessageFlowLiveTree', () => ({
  buildTopicMessageFlowLiveState: ({
    topicId,
    messages,
    activeNodeId
  }: {
    topicId: string
    messages: CherryUIMessage[]
    activeNodeId: string | null
  }) => ({
    topicId,
    activeNodeId,
    messageIds: messages.map((message) => message.id),
    messages
  })
}))

vi.mock('@renderer/components/chat/messages/stream/useMessageStreamingLayers', () => ({
  createOverlayRefreshHandoff: () => vi.fn(),
  useMessageStreamingLayers: () => ({
    partsByMessageId: {},
    liveMessageIds: mocks.liveMessageIds,
    streamingLayers: { liveMessageIds: mocks.liveMessageIds }
  })
}))

vi.mock('@renderer/components/chat/messages/utils/dispatchLocateMessage', () => ({
  dispatchLocateMessage: vi.fn()
}))

vi.mock('@renderer/components/composer/useToolApprovalComposerOverrides', () => ({
  useToolApprovalComposerOverrides: () => []
}))

vi.mock('@renderer/hooks/useChatWithHistory', () => ({
  useChatWithHistory: () => ({
    regenerate: vi.fn(),
    stop: vi.fn(),
    setMessages: vi.fn(),
    activeExecutions: mocks.activeExecutions
  })
}))

vi.mock('@renderer/hooks/useConversationTurnController', () => ({
  useConversationTurnController: (config: unknown) => {
    mocks.turnControllerConfig = config
    return { send: vi.fn(), phase: 'idle' }
  }
}))

vi.mock('@renderer/hooks/useExecutionOverlay', () => ({
  useExecutionOverlay: (
    conversation: ConversationRef,
    executions: ConversationExecutionProjection[],
    _messages: CherryUIMessage[],
    options?: {
      onFinish?: (executionId: string, event: ExecutionFinishEvent) => void
      refreshOnQuiesced?: () => Promise<unknown>
    }
  ) => {
    const key = conversationRefKey(conversation)
    const keyRef = useRef(key)
    const [projection, setProjection] = useState<{
      key: string
      optimisticMessages: CherryUIMessage[]
      optimisticExecutions: ConversationExecutionProjection[]
      activeNodeOverride: { previousActiveNodeId: string | null; activeNodeId: string } | null
    }>({ key, optimisticMessages: [], optimisticExecutions: [], activeNodeOverride: null })
    useEffect(() => {
      if (keyRef.current === key) return
      keyRef.current = key
      setProjection({ key, optimisticMessages: [], optimisticExecutions: [], activeNodeOverride: null })
    }, [key])
    mocks.overlayExecutions = executions
    mocks.overlayOnFinish = options?.onFinish ?? null
    mocks.overlayRefreshOnQuiesced = options?.refreshOnQuiesced ?? null
    return {
      overlay: {},
      liveAssistants: mocks.liveAssistants,
      optimisticMessages: projection.key === key ? projection.optimisticMessages : [],
      projectedExecutions: [...executions, ...(projection.key === key ? projection.optimisticExecutions : [])],
      activeNodeOverride: projection.key === key ? projection.activeNodeOverride : null,
      seedReservations: (
        messages: CherryUIMessage[],
        openedExecutions: ConversationExecutionProjection[],
        activeNodeDecision: ActiveNodeDecision | undefined,
        previousActiveNodeId: string | null
      ) => {
        setProjection({
          key,
          optimisticMessages: messages,
          optimisticExecutions: openedExecutions,
          activeNodeOverride:
            activeNodeDecision?.move === ConversationActiveNodeMove.Keep || !messages.at(-1)?.id
              ? null
              : { previousActiveNodeId, activeNodeId: messages.at(-1)!.id }
        })
      },
      disposeOverlay: vi.fn(),
      reset: vi.fn()
    }
  }
}))

vi.mock('@renderer/hooks/useToolApprovalBridge', () => ({
  useToolApprovalBridge: () => vi.fn()
}))

vi.mock('@renderer/hooks/useConversationStreamStatus', () => ({
  useConversationStreamStatus: () => ({ conversationBusy: false })
}))

vi.mock('../hooks/useChatWriteActions', () => ({
  useChatWriteActions: () => ({ actions: {} })
}))

vi.mock('../hooks/useTopicMessagesCache', () => ({
  useTopicMessagesCache: () => ({
    seedReservedMessages: mocks.seedMessagesCache,
    rollbackBranch: mocks.rollbackBranch
  })
}))

import { useChatRuntimeState } from '../useChatRuntimeState'

function makeTopic(id: string): Topic {
  return {
    id,
    assistantId: 'assistant-1',
    name: 'Topic',
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
    pinned: false,
    isNameManuallyEdited: false
  }
}

const reservedMessage = {
  id: 'reserved-1',
  role: 'assistant',
  parts: [],
  metadata: { status: 'pending', modelId: 'provider::model' }
} as unknown as CherryUIMessage

function RuntimeHost({
  topicId,
  activeNodeId = null,
  messages = []
}: {
  topicId: string
  activeNodeId?: string | null
  messages?: CherryUIMessage[]
}) {
  const topic = useMemo(() => makeTopic(topicId), [topicId])
  useChatRuntimeState({
    topic,
    isHistoryLoading: false,
    initialMessages: messages,
    uiMessages: messages,
    refresh: mocks.refresh,
    activeNodeId,
    messagesCacheMutate: vi.fn(),
    onBranchLiveStateChange: mocks.onBranchLiveStateChange
  })
  return null
}

// <Activity> harness: tab switches hide/show the chat UI without unmounting
// it, so hooks keep their state but effects are destroyed and re-created.
function ActivityHarness({ topicId, mode }: { topicId: string; mode: 'visible' | 'hidden' }) {
  return (
    <Activity mode={mode}>
      <RuntimeHost topicId={topicId} />
    </Activity>
  )
}

const lastBranchContribution = () => mocks.onBranchLiveStateChange.mock.calls.at(-1)?.[0]
const lastBranchState = () => lastBranchContribution()?.state

describe('useChatRuntimeState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.turnControllerConfig = null
    mocks.refresh.mockResolvedValue([])
    mocks.seedMessagesCache.mockResolvedValue(undefined)
    mocks.activeExecutions = []
    mocks.overlayExecutions = []
    mocks.liveMessageIds = []
    mocks.liveAssistants = []
    mocks.overlayOnFinish = null
  })

  it('keeps branch-live state across Activity and scopes later contributions to the new topic', async () => {
    const view = render(<ActivityHarness mode="visible" topicId="topic-1" />)

    // Seed a reserved branch message the way a turn does, through the history
    // adapter handed to the turn controller.
    await act(async () => {
      await mocks.turnControllerConfig.historyAdapter.seedReservedMessages([reservedMessage])
    })
    expect(lastBranchContribution()).toEqual({
      topicId: 'topic-1',
      state: expect.objectContaining({ topicId: 'topic-1', messageIds: ['reserved-1'] })
    })

    // Same topic hidden→visible: effects re-run with an unchanged topic id, and
    // the branch-live surface must survive instead of collapsing to null.
    view.rerender(<ActivityHarness mode="hidden" topicId="topic-1" />)
    view.rerender(<ActivityHarness mode="visible" topicId="topic-1" />)
    expect(mocks.onBranchLiveStateChange.mock.calls.every(([contribution]) => contribution.state !== null)).toBe(true)
    expect(lastBranchState()).toEqual(expect.objectContaining({ topicId: 'topic-1', messageIds: ['reserved-1'] }))

    // Actual topic change: every later contribution carries B's identity, so stale A cleanup cannot clear B.
    view.rerender(<ActivityHarness mode="visible" topicId="topic-2" />)
    await act(async () => {
      await mocks.turnControllerConfig.historyAdapter.seedReservedMessages([{ ...reservedMessage, id: 'reserved-2' }])
    })
    expect(lastBranchContribution()).toEqual({
      topicId: 'topic-2',
      state: expect.objectContaining({ topicId: 'topic-2', messageIds: ['reserved-2'] })
    })
  })

  it('preserves the cached active node when Main marks a live-group append as non-activating', async () => {
    render(<RuntimeHost topicId="topic-1" activeNodeId="selected-branch" />)

    await act(async () => {
      await mocks.turnControllerConfig.historyAdapter.seedReservedMessages([reservedMessage], {
        activeNodeDecision: { move: ConversationActiveNodeMove.Keep }
      })
    })

    expect(mocks.seedMessagesCache).toHaveBeenCalledWith([reservedMessage], {
      activeNodeDecision: { move: ConversationActiveNodeMove.Keep }
    })
    expect(lastBranchState()).toEqual(expect.objectContaining({ activeNodeId: 'selected-branch' }))
  })

  it('optimistically activates an ordinary reserved turn before the topic cache catches up', async () => {
    render(<RuntimeHost topicId="topic-1" activeNodeId="selected-branch" />)

    await act(async () => {
      await mocks.turnControllerConfig.historyAdapter.seedReservedMessages([reservedMessage])
    })

    expect(lastBranchState()).toEqual(expect.objectContaining({ activeNodeId: 'reserved-1' }))
  })

  it('projects branch flow with optimistic < persisted < live message authority', async () => {
    const message = (id: string, text: string) =>
      ({ id, role: 'assistant', parts: [{ type: 'text', text }] }) as CherryUIMessage
    mocks.liveMessageIds = ['persisted-wins', 'live-wins']
    mocks.liveAssistants = [message('live-wins', 'live')]

    render(
      <RuntimeHost
        topicId="topic-1"
        messages={[message('persisted-wins', 'persisted'), message('live-wins', 'persisted')]}
      />
    )

    await act(async () => {
      await mocks.turnControllerConfig.historyAdapter.seedReservedMessages([
        message('persisted-wins', 'optimistic'),
        message('live-wins', 'optimistic')
      ])
    })

    const projected = lastBranchState().messages as CherryUIMessage[]
    expect(projected.find((item) => item.id === 'persisted-wins')?.parts).toEqual([{ type: 'text', text: 'persisted' }])
    expect(projected.find((item) => item.id === 'live-wins')?.parts).toEqual([{ type: 'text', text: 'live' }])
  })
})
