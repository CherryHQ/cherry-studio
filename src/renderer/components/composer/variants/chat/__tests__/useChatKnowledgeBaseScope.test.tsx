import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useChatKnowledgeBaseScope } from '../useChatKnowledgeBaseScope'

const kb = (id: string, name = id): KnowledgeBase => ({ id, name }) as KnowledgeBase

describe('useChatKnowledgeBaseScope', () => {
  it('treats an empty assistant knowledge-base list as all loaded bases selectable', () => {
    const bases = [kb('kb-1', 'Knowledge One'), kb('kb-2', 'Knowledge Two')]

    const { result, rerender } = renderHook(() =>
      useChatKnowledgeBaseScope({
        assistantKnowledgeBaseIds: [],
        allKnowledgeBases: bases,
        isKnowledgeBasesLoading: false,
        topicId: 'topic-1',
        selectedAssistantId: 'assistant-1',
        selectedKnowledgeBases: [bases[0]],
        setSelectedKnowledgeBases: vi.fn()
      })
    )

    expect(result.current.selectableKnowledgeBases).toEqual(bases)
    rerender()
    expect(result.current.selectedKnowledgeBasesInScope).toEqual([bases[0]])
    expect(result.current.resolveKnowledgeBaseMarker('Knowledge Two')).toMatchObject({
      id: 'knowledge:kb-2',
      kind: 'knowledge'
    })
  })
})
