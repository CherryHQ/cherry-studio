import { describe, expect, it } from 'vitest'

import {
  getVersionSelectionMap,
  messagesSlice,
  selectMessagesForTopic,
  selectRawMessagesForTopic
} from '../newMessage'

describe('newMessage branch-aware selectors', () => {
  it('keeps raw messages but only shows the selected branch in the visible selector', () => {
    const topicId = 'topic-1'
    const baseMessages = [
      {
        id: 'user-0',
        role: 'user',
        assistantId: 'assistant-1',
        topicId,
        createdAt: '2026-01-01T00:00:00.000Z',
        status: 'success',
        blocks: []
      },
      {
        id: 'assistant-0',
        role: 'assistant',
        assistantId: 'assistant-1',
        topicId,
        createdAt: '2026-01-01T00:00:01.000Z',
        status: 'success',
        askId: 'user-0',
        blocks: []
      },
      {
        id: 'user-1',
        role: 'user',
        assistantId: 'assistant-1',
        topicId,
        createdAt: '2026-01-01T00:00:02.000Z',
        status: 'success',
        blocks: [],
        versionGroupId: 'user-1',
        versionNumber: 1,
        versionSelected: false,
        branchVersionSelections: {
          'user-1': 'user-1'
        }
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        assistantId: 'assistant-1',
        topicId,
        createdAt: '2026-01-01T00:00:03.000Z',
        status: 'success',
        askId: 'user-1',
        blocks: [],
        branchVersionSelections: {
          'user-1': 'user-1'
        }
      },
      {
        id: 'user-2',
        role: 'user',
        assistantId: 'assistant-1',
        topicId,
        createdAt: '2026-01-01T00:00:04.000Z',
        status: 'success',
        blocks: [],
        branchVersionSelections: {
          'user-1': 'user-1'
        }
      },
      {
        id: 'user-1-v2',
        role: 'user',
        assistantId: 'assistant-1',
        topicId,
        createdAt: '2026-01-01T00:00:05.000Z',
        status: 'success',
        blocks: [],
        versionGroupId: 'user-1',
        versionNumber: 2,
        versionSelected: true,
        branchVersionSelections: {
          'user-1': 'user-1-v2'
        }
      },
      {
        id: 'assistant-1-v2',
        role: 'assistant',
        assistantId: 'assistant-1',
        topicId,
        createdAt: '2026-01-01T00:00:06.000Z',
        status: 'success',
        askId: 'user-1-v2',
        blocks: [],
        branchVersionSelections: {
          'user-1': 'user-1-v2'
        }
      }
    ] as const

    let state = messagesSlice.reducer(undefined, { type: 'init' })
    state = messagesSlice.reducer(state, messagesSlice.actions.messagesReceived({ topicId, messages: [...baseMessages] as any }))

    const rootState = {
      messages: state
    } as any

    expect(selectRawMessagesForTopic(rootState, topicId).map((message) => message.id)).toEqual(
      baseMessages.map((message) => message.id)
    )
    expect(selectMessagesForTopic(rootState, topicId).map((message) => message.id)).toEqual([
      'user-0',
      'assistant-0',
      'user-1-v2',
      'assistant-1-v2'
    ])
  })

  it('defaults a version group to the latest message when no explicit selection is stored', () => {
    const messages = [
      {
        id: 'user-1',
        role: 'user',
        assistantId: 'assistant-1',
        topicId: 'topic-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        status: 'success',
        blocks: [],
        versionGroupId: 'user-1',
        versionNumber: 1
      },
      {
        id: 'user-1-v2',
        role: 'user',
        assistantId: 'assistant-1',
        topicId: 'topic-1',
        createdAt: '2026-01-01T00:00:01.000Z',
        status: 'success',
        blocks: [],
        versionGroupId: 'user-1',
        versionNumber: 2
      }
    ] as any

    expect(getVersionSelectionMap(messages)).toEqual({
      'user-1': 'user-1-v2'
    })
  })
})
