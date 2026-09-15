import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MessageKnowledgeSearchToolTitle } from '../MessageKnowledgeSearch'

vi.mock('@renderer/i18n/resolver', () => ({
  default: {
    t: (key: string, params?: Record<string, number>) => {
      if (key === 'message.searching') return 'Searching'
      if (key === 'message.websearch.fetch_complete') return `${params?.count} search results`
      if (key === 'knowledge.recall.rerank_warning') return 'Reranking did not complete.'
      if (key === 'knowledge.recall.rerank_warning_provider_error') return 'Check provider settings.'
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
        toolResponse={{
          id: 'tool-call-1',
          toolCallId: 'tool-call-1',
          tool: { id: 'knowledge-search', name: 'kb_search', type: 'builtin' },
          status: 'done',
          arguments: { query: 'Cherry Studio', baseIds: ['base-1'] },
          response: [{ id: 1, content: 'Cherry Studio', score: 0.9 }]
        }}
      />
    )

    expect(screen.getByText('1 search results')).toBeInTheDocument()
    expect(screen.queryByTestId('file-search-icon')).toBeNull()

    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByText('Cherry Studio')).toBeInTheDocument()
  })

  it('renders one safe fallback warning from the result array', async () => {
    render(
      <MessageKnowledgeSearchToolTitle
        toolResponse={{
          id: 'tool-call-2',
          toolCallId: 'tool-call-2',
          tool: { id: 'knowledge-search', name: 'kb_search', type: 'builtin' },
          status: 'done',
          arguments: { query: 'Cherry Studio', baseIds: ['base-1'] },
          response: [
            {
              id: 1,
              content: 'fallback one',
              score: 0.9,
              warning: { kind: 'rerank_failed', reason: 'provider_error' }
            },
            {
              id: 2,
              content: 'fallback two',
              score: 0.8,
              warning: { kind: 'rerank_failed', reason: 'provider_error' }
            }
          ]
        }}
      />
    )

    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findAllByText(/Reranking did not complete/)).toHaveLength(1)
    expect(screen.getByText(/Check provider settings/)).toBeInTheDocument()
  })
})
