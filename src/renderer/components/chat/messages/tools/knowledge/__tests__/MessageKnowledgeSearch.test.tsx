import type { NormalToolResponse } from '@renderer/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MessageKnowledgeSearchToolTitle } from '../MessageKnowledgeSearch'

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string, params?: Record<string, number>) => {
      if (key === 'message.searching') return 'Searching'
      if (key === 'message.websearch.fetch_complete') return `${params?.count} search results`
      return key
    }
  }
}))

vi.mock('lucide-react', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    FileSearch: ({ className, size }: { className?: string; size?: number | string }) => (
      <span data-testid="file-search-icon" data-size={size} className={className} />
    )
  }
})

describe('MessageKnowledgeSearchToolTitle', () => {
  it('wraps result details in the shared disclosure container', async () => {
    render(
      <MessageKnowledgeSearchToolTitle
        toolResponse={
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'knowledge-search', name: 'kb_search', type: 'builtin' },
            status: 'done',
            arguments: { query: 'Cherry Studio', baseIds: ['base-1'] },
            response: [{ id: 1, content: 'Cherry Studio', score: 0.9 }]
          } as NormalToolResponse
        }
      />
    )

    const title = screen.getByText('1 search results').closest('span')
    expect(title).toHaveClass('flex items-center gap-1.5 py-0.5 text-[13px] leading-5 text-foreground-secondary')
    expect(title).not.toHaveClass('text-sm')
    expect(screen.getByTestId('file-search-icon')).toHaveAttribute('data-size', '14')
    expect(screen.getByTestId('file-search-icon')).toHaveClass('shrink-0 text-foreground-muted')

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByTestId('collapse-content-tool-call-1')).toHaveClass('rounded-xl bg-muted px-4 py-3')
    expect(await screen.findByText('Cherry Studio')).toBeInTheDocument()
  })

  it('uses compact text while searching', () => {
    render(
      <MessageKnowledgeSearchToolTitle
        toolResponse={
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'knowledge-search', name: 'kb_search', type: 'builtin' },
            status: 'invoking',
            arguments: { query: 'Cherry Studio', baseIds: ['base-1'] },
            response: []
          } as NormalToolResponse
        }
      />
    )

    const searchingText = screen.getByText('Searching').closest('span')
    expect(searchingText).toHaveClass('py-0.5 text-[13px] leading-5')
    expect(searchingText).not.toHaveClass('text-sm')
    expect(screen.getByText('Cherry Studio')).toHaveClass('truncate')
  })
})
