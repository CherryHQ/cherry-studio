import { type AnyAction, configureStore, type Middleware } from '@reduxjs/toolkit'
import type { MainTextMessageBlock, Message, MessageBlock } from '@renderer/types/newMessage'
import {
  AssistantMessageStatus,
  MessageBlockStatus,
  MessageBlockType,
  UserMessageStatus
} from '@renderer/types/newMessage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchMessages: vi.fn()
}))

vi.mock('@renderer/services/db/DbService', () => ({
  dbService: {
    fetchMessages: mocks.fetchMessages
  }
}))

import messageBlocksReducer, { messageBlocksSelectors } from '../../messageBlock'
import newMessagesReducer, { newMessagesActions, selectMessagesForTopic } from '../../newMessage'
import { hydrateBranchTopicMessagesThunk } from '../branchMessageHydrationThunk'

function makeMessage(overrides: Partial<Message> & Pick<Message, 'id' | 'topicId' | 'role'>): Message {
  const { id, topicId, role, assistantId, status, createdAt, blocks, ...rest } = overrides

  return {
    ...rest,
    id,
    assistantId: assistantId ?? 'asst-1',
    topicId,
    role,
    status: status ?? (role === 'user' ? UserMessageStatus.SUCCESS : AssistantMessageStatus.SUCCESS),
    createdAt: createdAt ?? '2026-07-07T00:00:00.000Z',
    blocks: blocks ?? []
  }
}

function makeBlock(
  overrides: Partial<MainTextMessageBlock> & Pick<MainTextMessageBlock, 'id' | 'messageId'>
): MessageBlock {
  const { id, messageId, type, status, createdAt, content, ...rest } = overrides

  return {
    ...rest,
    id,
    messageId,
    type: type ?? MessageBlockType.MAIN_TEXT,
    status: status ?? MessageBlockStatus.SUCCESS,
    createdAt: createdAt ?? '2026-07-07T00:00:00.000Z',
    content: content ?? 'hydrated branch block'
  } as MessageBlock
}

function makeStore() {
  const actions: AnyAction[] = []
  const recordActions: Middleware = () => (next) => (action) => {
    if (typeof action !== 'function') {
      actions.push(action as AnyAction)
    }
    return next(action)
  }

  const store = configureStore({
    reducer: {
      messages: newMessagesReducer,
      messageBlocks: messageBlocksReducer
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(recordActions)
  })

  return { store, actions }
}

describe('hydrateBranchTopicMessagesThunk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hydrates branch messages and blocks without changing currentTopicId or using active-topic reducers', async () => {
    const branchMessages = [
      makeMessage({ id: 'branch-msg-1', topicId: 'topic-branch', role: 'user', blocks: ['branch-block-1'] }),
      makeMessage({ id: 'branch-msg-2', topicId: 'topic-branch', role: 'assistant', blocks: ['branch-block-2'] })
    ]
    const branchBlocks = [
      makeBlock({ id: 'branch-block-1', messageId: 'branch-msg-1' }),
      makeBlock({ id: 'branch-block-2', messageId: 'branch-msg-2' })
    ]
    mocks.fetchMessages.mockResolvedValue({ messages: branchMessages, blocks: branchBlocks })

    const { store, actions } = makeStore()
    store.dispatch(newMessagesActions.setCurrentTopicId('topic-main'))
    actions.length = 0

    const result = await (store.dispatch as any)(hydrateBranchTopicMessagesThunk('topic-branch'))

    expect(result).toEqual(branchMessages)
    expect(mocks.fetchMessages).toHaveBeenCalledWith('topic-branch')
    expect(store.getState().messages.currentTopicId).toBe('topic-main')
    expect(store.getState().messages.messageIdsByTopic['topic-branch']).toEqual(['branch-msg-1', 'branch-msg-2'])
    expect(selectMessagesForTopic(store.getState() as any, 'topic-branch')).toEqual(branchMessages)
    expect(messageBlocksSelectors.selectById(store.getState() as any, 'branch-block-1')).toMatchObject({
      id: 'branch-block-1',
      messageId: 'branch-msg-1'
    })
    expect(store.getState().messages.loadingByTopic['topic-branch']).toBe(false)
    expect(store.getState().messages.fulfilledByTopic['topic-branch']).toBe(true)

    const actionTypes = actions.map((action) => action.type)
    expect(actionTypes).not.toContain(newMessagesActions.setCurrentTopicId.type)
    expect(actionTypes).not.toContain(newMessagesActions.messagesReceived.type)
    expect(actionTypes).toContain(newMessagesActions.branchTopicMessagesHydrated.type)
  })

  it('throws fetch failures and preserves currentTopicId', async () => {
    const error = new Error('fetch failed')
    mocks.fetchMessages.mockRejectedValue(error)
    const { store, actions } = makeStore()
    store.dispatch(newMessagesActions.setCurrentTopicId('topic-main'))
    actions.length = 0

    await expect((store.dispatch as any)(hydrateBranchTopicMessagesThunk('topic-branch'))).rejects.toThrow(
      'fetch failed'
    )

    expect(store.getState().messages.currentTopicId).toBe('topic-main')
    expect(store.getState().messages.messageIdsByTopic['topic-branch']).toBeUndefined()
    expect(store.getState().messages.loadingByTopic['topic-branch']).toBe(false)
    expect(store.getState().messages.fulfilledByTopic['topic-branch']).toBeUndefined()

    const actionTypes = actions.map((action) => action.type)
    expect(actionTypes).not.toContain(newMessagesActions.setCurrentTopicId.type)
    expect(actionTypes).not.toContain(newMessagesActions.messagesReceived.type)
    expect(actionTypes).not.toContain(newMessagesActions.branchTopicMessagesHydrated.type)
  })
})
