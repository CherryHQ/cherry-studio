import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus } from '@renderer/types/newMessage'
import { describe, expect, it } from 'vitest'

import { legacyMessageToListItem } from './legacyMessageListItem'

describe('legacyMessageToListItem', () => {
  it('preserves history-only display fields from legacy messages', () => {
    const message: Message = {
      id: 'message-1',
      role: 'assistant',
      assistantId: 'assistant-1',
      topicId: 'topic-1',
      createdAt: '2026-05-14T00:00:00.000Z',
      status: AssistantMessageStatus.SUCCESS,
      modelId: 'provider-1::model-1',
      model: {
        id: 'model-1',
        provider: 'provider-1',
        name: 'Model One',
        group: 'group-1'
      },
      type: 'clear',
      askId: 'parent-1',
      siblingsGroupId: 7,
      mentions: [
        {
          id: 'mention-model',
          provider: 'provider-2',
          name: 'Mention Model',
          group: 'group-2'
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
        thoughts_tokens: 5,
        cost: 0.12
      },
      metrics: {
        completion_tokens: 99,
        time_first_token_millsec: 100,
        time_completion_millsec: 200,
        time_thinking_millsec: 300
      },
      blocks: [],
      traceId: 'trace-1'
    }

    expect(legacyMessageToListItem(message)).toMatchObject({
      id: 'message-1',
      parentId: 'parent-1',
      type: 'clear',
      mentions: [
        {
          id: 'mention-model',
          provider: 'provider-2',
          name: 'Mention Model',
          group: 'group-2'
        }
      ],
      stats: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        thoughtsTokens: 5,
        cost: 0.12,
        timeFirstTokenMs: 100,
        timeCompletionMs: 200,
        timeThinkingMs: 300
      },
      traceId: 'trace-1'
    })
  })
})
