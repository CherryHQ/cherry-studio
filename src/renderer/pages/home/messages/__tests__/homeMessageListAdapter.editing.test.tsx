import { dataApiService } from '@data/DataApiService'
import { MessageEditingProvider, useMessageEditing } from '@renderer/components/chat/editing/MessageEditingContext'
import { toMessageListItem } from '@renderer/components/chat/messages/utils/messageListItem'
import type { Topic } from '@renderer/types/topic'
import { sharedMessageToUIMessage } from '@renderer/utils/message/messageProjection'
import type { BranchMessagesResponse, CherryMessagePart, CherryUIMessage, Message } from '@shared/data/types/message'
import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({ trigger }: { trigger: ReactNode }) => trigger
}))

vi.mock('@renderer/hooks/translate', () => ({
  useLanguages: () => ({
    languages: [],
    getLabel: () => '',
    status: 'ready',
    refetch: vi.fn()
  })
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessageListAdapterCapabilities', () => ({
  useMessageListAdapterCapabilities: () => ({
    errorActions: {},
    exportActions: {},
    getMessageActivityState: vi.fn(),
    messageActivityStore: {},
    headerCapabilities: {},
    leafCapabilities: {},
    menuConfig: {},
    messageUiStateCache: { getMessageUiState: vi.fn(), updateMessageUiState: vi.fn() },
    renderConfig: {},
    selectionController: { selection: {}, actions: {} },
    updateRenderConfig: vi.fn()
  })
}))

import { useHomeMessageListProviderValue } from '../homeMessageListAdapter'

const parts: CherryMessagePart[] = [{ type: 'text', text: 'Question' }]

function persistedMessage(id: string, role: Message['role'], parentId = 'vroot'): Message {
  return {
    id,
    role,
    parentId,
    topicId: 'topic-a',
    data: { parts },
    searchableText: 'Question',
    status: 'success',
    siblingsGroupId: 0,
    modelId: null,
    messageSnapshot: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

const user = persistedMessage('user-1', 'user')
const replies = ['a', 'b'].map(
  (model): Message => ({
    ...persistedMessage(`reply-${model}`, 'assistant', user.id),
    siblingsGroupId: 1,
    modelId: `provider::${model}`,
    messageSnapshot: {
      id: 'assistant-1',
      name: 'Assistant',
      model: { id: model, name: `Original ${model.toUpperCase()}`, provider: 'provider' }
    }
  })
)
const branchResponse: BranchMessagesResponse = {
  items: [{ message: user }, { message: replies[0], siblingsGroup: replies }],
  activeNodeId: replies[0].id,
  rootId: 'vroot',
  assistantId: null
}

function messageItem(message: Message) {
  return toMessageListItem(sharedMessageToUIMessage(message), { topicId: message.topicId })
}

function renderAdapter(messages: CherryUIMessage[] = []) {
  return renderHook(
    () => {
      const topic: Topic = {
        id: 'topic-a',
        assistantId: undefined,
        name: 'Topic',
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastActivityAt: user.createdAt,
        messages: []
      }
      const value = useHomeMessageListProviderValue({ topic, messages, partsByMessageId: {} })
      return { actions: value.actions, editing: useMessageEditing() }
    },
    { wrapper: MessageEditingProvider }
  )
}

describe('Home message editing model locks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockDataApiUtils.resetMocks()
  })

  it('locks the original models synchronously when the active branch replies are loaded', () => {
    const { result } = renderAdapter([user, ...replies].map(sharedMessageToUIMessage))

    act(() => result.current.actions.startEditing?.({ ...messageItem(user), isActiveBranch: true }, parts))

    const lockedModels = result.current.editing.editingMessage?.lockedMentionedModels
    expect(lockedModels?.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'provider::a', name: 'Original A' },
      { id: 'provider::b', name: 'Original B' }
    ])
    expect(dataApiService.get).not.toHaveBeenCalled()
  })

  it('loads all reply models before editing an inactive user already present without its replies', async () => {
    MockDataApiUtils.setCustomResponse('/topics/topic-a/path', 'GET', [user, replies[0]])
    MockDataApiUtils.setCustomResponse('/topics/topic-a/messages', 'GET', branchResponse)
    const { result } = renderAdapter([sharedMessageToUIMessage(user)])

    act(() => result.current.actions.startEditing?.({ ...messageItem(user), isActiveBranch: false }, parts))

    expect(result.current.editing.editingMessage).toBeNull()
    await waitFor(() => {
      const lockedModels = result.current.editing.editingMessage?.lockedMentionedModels
      expect(lockedModels?.map(({ id, name }) => ({ id, name }))).toEqual([
        { id: 'provider::a', name: 'Original A' },
        { id: 'provider::b', name: 'Original B' }
      ])
    })
    expect(dataApiService.get).toHaveBeenCalledWith('/topics/topic-a/messages', {
      query: { nodeId: 'reply-a', limit: 2, includeSiblings: true }
    })
  })

  it('does not reopen a pending branch edit after another entry point starts editing', async () => {
    let finishLoading: (value: BranchMessagesResponse) => void = () => {}
    const response = new Promise<BranchMessagesResponse>((resolve) => {
      finishLoading = resolve
    })
    vi.mocked(dataApiService.get).mockResolvedValueOnce([user, replies[0]]).mockReturnValueOnce(response)
    const { result } = renderAdapter()

    act(() => result.current.actions.startEditing?.(messageItem(user), parts))
    await waitFor(() => expect(dataApiService.get).toHaveBeenCalledWith('/topics/topic-a/messages', expect.anything()))

    const nextMessage = messageItem(persistedMessage('user-2', 'user'))
    act(() => result.current.editing.startEditing(nextMessage, parts))
    await act(async () => {
      finishLoading(branchResponse)
      await response
    })

    expect(result.current.editing.editingMessage?.message.id).toBe('user-2')
    expect(result.current.editing.editingMessage?.lockedMentionedModels).toBeUndefined()
  })
})
