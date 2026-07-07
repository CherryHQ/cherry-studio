import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus, UserMessageStatus } from '@renderer/types/newMessage'
import { describe, expect, it } from 'vitest'

import newMessagesReducer, { newMessagesActions } from '../newMessage'

const INITIAL_STATE = newMessagesReducer(undefined, { type: '@@INIT' })

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

describe('newMessagesActions.branchTopicMessagesHydrated', () => {
  it('updates messageIdsByTopic for the branch topic and preserves currentTopicId', () => {
    const state = newMessagesReducer(INITIAL_STATE, newMessagesActions.setCurrentTopicId('topic-main'))
    const branchMessages = [
      makeMessage({ id: 'branch-msg-1', topicId: 'topic-branch', role: 'user' }),
      makeMessage({ id: 'branch-msg-2', topicId: 'topic-branch', role: 'assistant' })
    ]

    const next = newMessagesReducer(
      state,
      newMessagesActions.branchTopicMessagesHydrated({
        topicId: 'topic-branch',
        messages: branchMessages
      })
    )

    expect(next.currentTopicId).toBe('topic-main')
    expect(next.messageIdsByTopic['topic-branch']).toEqual(['branch-msg-1', 'branch-msg-2'])
    expect(next.entities['branch-msg-1']).toMatchObject({ id: 'branch-msg-1', topicId: 'topic-branch' })
    expect(next.entities['branch-msg-2']).toMatchObject({ id: 'branch-msg-2', topicId: 'topic-branch' })
  })

  it('preserves existing messagesReceived behavior for active-topic loads', () => {
    const state = newMessagesReducer(INITIAL_STATE, newMessagesActions.setCurrentTopicId('topic-main'))
    const messages = [makeMessage({ id: 'msg-1', topicId: 'topic-loaded', role: 'user' })]

    const next = newMessagesReducer(
      state,
      newMessagesActions.messagesReceived({
        topicId: 'topic-loaded',
        messages
      })
    )

    expect(next.currentTopicId).toBe('topic-loaded')
    expect(next.messageIdsByTopic['topic-loaded']).toEqual(['msg-1'])
  })
})
