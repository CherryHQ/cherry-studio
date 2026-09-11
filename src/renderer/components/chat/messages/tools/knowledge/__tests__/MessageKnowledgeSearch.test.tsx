import type { NormalToolResponse } from '@renderer/types/mcpTool'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MessageKnowledgeSearchToolTitle } from '../MessageKnowledgeSearch'

vi.mock('@renderer/i18n/resolver', () => ({
  default: {
    t: (key: string, params?: Record<string, number>) => {
      if (key === 'message.searching') return 'Searching'
      if (key === 'message.tools.error') return 'Failed'
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
  const invokingResponse = {
    id: 'tool-call-1',
    toolCallId: 'tool-call-1',
    tool: { id: 'knowledge-search', name: 'kb_search', type: 'builtin' },
    status: 'invoking',
    arguments: { query: 'Cherry Studio', baseIds: ['base-1'] }
  } as NormalToolResponse

  it('keeps showing the spinner while the search is in flight', () => {
    render(<MessageKnowledgeSearchToolTitle toolResponse={invokingResponse} />)

    expect(screen.getByText('Searching')).toBeInTheDocument()
    expect(screen.getByText('Cherry Studio')).toBeInTheDocument()
    expect(screen.queryByText('Failed')).not.toBeInTheDocument()
  })

  it('marks a failed search instead of spinning forever', () => {
    render(<MessageKnowledgeSearchToolTitle toolResponse={{ ...invokingResponse, status: 'error' }} />)

    expect(screen.getByText('Cherry Studio')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.queryByText('Searching')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders a terminal error when malformed input has no usable query', () => {
    render(
      <MessageKnowledgeSearchToolTitle toolResponse={{ ...invokingResponse, status: 'error', arguments: undefined }} />
    )

    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.queryByText('Searching')).not.toBeInTheDocument()
  })

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

    expect(screen.getByText('1 search results')).toBeInTheDocument()
    expect(screen.queryByTestId('file-search-icon')).toBeNull()

    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByText('Cherry Studio')).toBeInTheDocument()
  })
})
