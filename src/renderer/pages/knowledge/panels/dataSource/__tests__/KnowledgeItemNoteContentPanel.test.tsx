import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KnowledgeItemNoteContentPanel from '../KnowledgeItemNoteContentPanel'
import { createNoteItem } from './testUtils'

const mockUseQuery = vi.fn()

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args)
}))

vi.mock('@renderer/utils/time', () => ({
  formatRelativeTime: () => '刚刚'
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined
  },
  useTranslation: () => ({
    i18n: {
      language: 'zh-CN'
    },
    t: (key: string) =>
      (
        ({
          'common.back': '返回',
          'common.loading': '加载中',
          'knowledge.data_source.actions.preview_source': '预览原文',
          'knowledge.data_source.filters.note': '笔记'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

describe('KnowledgeItemNoteContentPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockReturnValue({
      data: createNoteItem({ id: 'note-1', content: '第一行标题\n第二行完整正文内容' }),
      isLoading: false,
      error: undefined
    })
  })

  it("renders the note's full original content and fetches the item by id", () => {
    render(<KnowledgeItemNoteContentPanel itemId="note-1" onBack={vi.fn()} />)

    expect(mockUseQuery).toHaveBeenCalledWith('/knowledge-items/:id', {
      params: { id: 'note-1' },
      enabled: true
    })
    // The whole body is present and untruncated — the reason a note needed its own view. The
    // header title only carries the first line, so matching the second line targets the body.
    expect(screen.getByText('第二行完整正文内容', { exact: false })).toHaveTextContent('第一行标题')
  })

  it('invokes onBack when the back control is pressed', () => {
    const onBack = vi.fn()
    render(<KnowledgeItemNoteContentPanel itemId="note-1" onBack={onBack} />)

    fireEvent.click(screen.getByRole('button', { name: '返回' }))

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('shows a loading state while the item is being fetched', () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: true, error: undefined })

    render(<KnowledgeItemNoteContentPanel itemId="note-1" onBack={vi.fn()} />)

    // Both the placeholder title and the body render the loading label while the item resolves.
    expect(screen.getAllByText('加载中').length).toBeGreaterThan(0)
  })
})
