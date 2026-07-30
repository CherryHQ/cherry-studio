import type { BranchMessagesResponse, CherryUIMessage } from '@shared/data/types/message'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useTopicMessagesCache, type UseTopicMessagesCacheParams } from '../useTopicMessagesCache'

describe('useTopicMessagesCache', () => {
  it('replaces a persisted draft by id and appends its reserved assistant without duplication', async () => {
    let pages: BranchMessagesResponse[] | undefined = [
      {
        items: [
          {
            message: {
              id: 'draft-user',
              topicId: 'topic-1',
              parentId: 'assistant-anchor',
              role: 'user',
              data: { parts: [], isBranchDraft: true },
              searchableText: '',
              status: 'success',
              siblingsGroupId: 0,
              modelId: null,
              messageSnapshot: null,
              stats: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z'
            }
          }
        ],
        nextCursor: undefined,
        activeNodeId: 'draft-user',
        assistantId: 'assistant-1',
        rootId: 'root-1'
      }
    ]
    const mutate = vi.fn(async (updater: unknown) => {
      if (typeof updater === 'function') {
        pages = await updater(pages)
      }
      return pages
    })
    const { result } = renderHook(() =>
      useTopicMessagesCache({
        topicId: 'topic-1',
        mutate: mutate as unknown as UseTopicMessagesCacheParams['mutate']
      })
    )
    const filledDraft: CherryUIMessage = {
      id: 'draft-user',
      role: 'user',
      parts: [{ type: 'text', text: 'new branch question' }],
      metadata: {
        parentId: 'assistant-anchor',
        status: 'success',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    }
    const assistantPlaceholder: CherryUIMessage = {
      id: 'assistant-placeholder',
      role: 'assistant',
      parts: [],
      metadata: {
        parentId: 'draft-user',
        status: 'pending',
        modelId: 'provider::model',
        createdAt: '2026-01-01T00:00:01.000Z'
      }
    }

    await act(async () => {
      await result.current.seedReservedMessages([filledDraft, assistantPlaceholder])
    })

    expect(pages?.[0].items.map((item) => item.message.id)).toEqual(['draft-user', 'assistant-placeholder'])
    expect(pages?.[0].items[0].message.data).toEqual({ parts: filledDraft.parts })
    expect(pages?.[0].items[0].message.data).not.toHaveProperty('isBranchDraft')
    expect(pages?.[0].activeNodeId).toBe('assistant-placeholder')
  })
})
