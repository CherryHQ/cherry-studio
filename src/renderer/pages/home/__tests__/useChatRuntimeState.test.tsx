import type { Topic } from '@renderer/types/topic'
import type { CherryUIMessage } from '@shared/data/types/message'
import { act, render } from '@testing-library/react'
import { Activity, useMemo } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  turnControllerConfig: null as any,
  onBranchLiveStateChange: vi.fn(),
  refresh: vi.fn(async () => [] as CherryUIMessage[]),
  seedMessagesCache: vi.fn(async () => undefined),
  rollbackBranch: vi.fn()
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
vi.mock('@renderer/components/chat/flow', () => ({
  buildTopicMessageFlowLiveState: ({ topicId, messages }: { topicId: string; messages: CherryUIMessage[] }) => ({
    topicId,
    messageIds: messages.map((message) => message.id)
  })
}))

vi.mock('@renderer/components/chat/messages/stream/useMessageStreamingLayers', () => ({
  createOverlayRefreshHandoff: () => vi.fn(),
  useMessageStreamingLayers: () => ({
    partsByMessageId: {},
    liveMessageIds: [],
    streamingLayers: { liveMessageIds: [] }
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
    activeExecutions: []
  })
}))

vi.mock('@renderer/hooks/useConversationTurnController', () => ({
  useConversationTurnController: (config: unknown) => {
    mocks.turnControllerConfig = config
    return { send: vi.fn(), phase: 'idle' }
  }
}))

vi.mock('@renderer/hooks/useExecutionOverlay', () => ({
  useExecutionOverlay: () => ({
    overlay: {},
    liveAssistants: [],
    disposeOverlay: vi.fn(),
    reset: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useToolApprovalBridge', () => ({
  useToolApprovalBridge: () => vi.fn()
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ isPending: false }),
  useTopicAwaitingApproval: () => false,
  useTopicOverlayHandoffOnTerminal: vi.fn()
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

function RuntimeHost({ topicId }: { topicId: string }) {
  const topic = useMemo(() => makeTopic(topicId), [topicId])
  useChatRuntimeState({
    topic,
    isHistoryLoading: false,
    initialMessages: [],
    uiMessages: [],
    refresh: mocks.refresh,
    activeNodeId: null,
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

describe('useChatRuntimeState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.turnControllerConfig = null
    mocks.refresh.mockResolvedValue([])
    mocks.seedMessagesCache.mockResolvedValue(undefined)
  })

  it('keeps branch-live state across an <Activity> hide/show and clears it when the topic changes', async () => {
    const view = render(<ActivityHarness mode="visible" topicId="topic-1" />)

    // Seed a reserved branch message the way a turn does, through the history
    // adapter handed to the turn controller.
    await act(async () => {
      await mocks.turnControllerConfig.historyAdapter.seedReservedMessages([reservedMessage])
    })
    expect(mocks.onBranchLiveStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ topicId: 'topic-1', messageIds: ['reserved-1'] })
    )

    // Same topic hidden→visible: effects re-run with an unchanged topic id, and
    // the branch-live surface must survive instead of collapsing to null.
    view.rerender(<ActivityHarness mode="hidden" topicId="topic-1" />)
    view.rerender(<ActivityHarness mode="visible" topicId="topic-1" />)
    expect(mocks.onBranchLiveStateChange).not.toHaveBeenCalledWith(null)
    expect(mocks.onBranchLiveStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ topicId: 'topic-1', messageIds: ['reserved-1'] })
    )

    // Actual topic change: the stale branch-live state must be dropped.
    view.rerender(<ActivityHarness mode="visible" topicId="topic-2" />)
    expect(mocks.onBranchLiveStateChange).toHaveBeenLastCalledWith(null)
  })
})
