import type { ExecutionFinishEvent } from '@renderer/hooks/useExecutionOverlay'
import type { Topic } from '@renderer/types/topic'
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import { act, render } from '@testing-library/react'
import { Activity, useMemo } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  turnControllerConfig: null as any,
  onBranchLiveStateChange: vi.fn(),
  refresh: vi.fn(async () => [] as CherryUIMessage[]),
  seedMessagesCache: vi.fn(async () => undefined),
  rollbackBranch: vi.fn(),
  activeExecutions: [] as ActiveExecution[],
  overlayExecutions: [] as ActiveExecution[],
  liveMessageIds: [] as string[],
  liveAssistants: [] as CherryUIMessage[],
  overlayOnFinish: null as ((executionId: string, event: ExecutionFinishEvent) => void) | null
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
    _topicId: string,
    executions: ActiveExecution[],
    _messages: CherryUIMessage[],
    options?: { onFinish?: (executionId: string, event: ExecutionFinishEvent) => void }
  ) => {
    mocks.overlayExecutions = executions
    mocks.overlayOnFinish = options?.onFinish ?? null
    return {
      overlay: {},
      liveAssistants: mocks.liveAssistants,
      disposeOverlay: vi.fn(),
      reset: vi.fn()
    }
  }
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

  it('preserves the cached active node when Main marks a live-group append as non-activating', async () => {
    render(<RuntimeHost topicId="topic-1" activeNodeId="selected-branch" />)

    await act(async () => {
      await mocks.turnControllerConfig.historyAdapter.seedReservedMessages([reservedMessage], {
        preserveActiveNode: true
      })
    })

    expect(mocks.seedMessagesCache).toHaveBeenCalledWith([reservedMessage], { preserveActiveNode: true })
    expect(mocks.onBranchLiveStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ activeNodeId: 'selected-branch' })
    )
  })

  it('optimistically activates an ordinary reserved turn before the topic cache catches up', async () => {
    render(<RuntimeHost topicId="topic-1" activeNodeId="selected-branch" />)

    await act(async () => {
      await mocks.turnControllerConfig.historyAdapter.seedReservedMessages([reservedMessage])
    })

    expect(mocks.onBranchLiveStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ activeNodeId: 'reserved-1' })
    )
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

    const projected = mocks.onBranchLiveStateChange.mock.calls.at(-1)?.[0].messages as CherryUIMessage[]
    expect(projected.find((item) => item.id === 'persisted-wins')?.parts).toEqual([{ type: 'text', text: 'persisted' }])
    expect(projected.find((item) => item.id === 'live-wins')?.parts).toEqual([{ type: 'text', text: 'live' }])
  })

  it('lets the newer Main attempt replace a stale optimistic attempt for the same model and anchor', async () => {
    const staleAttempt: ActiveExecution = {
      executionId: 'provider::model',
      anchorMessageId: 'reserved-1',
      attemptId: 1
    }
    mocks.activeExecutions = [staleAttempt]
    const view = render(<RuntimeHost topicId="topic-1" />)

    await act(async () => {
      await mocks.turnControllerConfig.historyAdapter.seedReservedMessages([reservedMessage], {
        activeExecutions: [staleAttempt]
      })
    })

    mocks.activeExecutions = [
      {
        executionId: 'provider::model',
        anchorMessageId: 'reserved-1',
        attemptId: 2,
        seedFromEmpty: true
      }
    ]
    view.rerender(<RuntimeHost topicId="topic-1" />)

    expect(mocks.overlayExecutions).toEqual([expect.objectContaining({ attemptId: 2, seedFromEmpty: true })])
  })

  it('does not restore a completed old attempt after its newer replacement settles', async () => {
    const staleAttempt: ActiveExecution = {
      executionId: 'provider::model',
      anchorMessageId: 'reserved-1',
      attemptId: 1
    }
    const view = render(<RuntimeHost topicId="topic-1" />)

    await act(async () => {
      await mocks.turnControllerConfig.historyAdapter.seedReservedMessages([reservedMessage], {
        activeExecutions: [staleAttempt]
      })
    })

    mocks.activeExecutions = [
      {
        executionId: 'provider::model',
        anchorMessageId: 'reserved-1',
        attemptId: 2
      }
    ]
    view.rerender(<RuntimeHost topicId="topic-1" />)

    const completedMessage = {
      ...reservedMessage,
      parts: [{ type: 'text', text: 'old attempt completed' }]
    } as CherryUIMessage
    await act(async () => {
      mocks.overlayOnFinish?.('provider::model', {
        attemptId: 1,
        message: completedMessage,
        isAbort: false,
        isError: false
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    mocks.activeExecutions = []
    view.rerender(<RuntimeHost topicId="topic-1" />)

    expect(mocks.overlayExecutions).toEqual([])
  })
})
