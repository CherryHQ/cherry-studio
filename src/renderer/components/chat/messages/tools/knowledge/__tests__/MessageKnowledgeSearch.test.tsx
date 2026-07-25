import type { NormalToolResponse } from '@renderer/types/mcpTool'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ToolResultLoadProvider } from '../../ToolResultLoadContext'
import { MessageKnowledgeSearchToolTitle } from '../MessageKnowledgeSearch'

vi.mock('@renderer/i18n/resolver', () => ({
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
  it('keeps a disclosure trigger while the result payload is deferred', () => {
    render(
      <ToolResultLoadProvider value={() => undefined}>
        <MessageKnowledgeSearchToolTitle
          toolResponse={
            {
              id: 'tool-call-1',
              toolCallId: 'tool-call-1',
              tool: { id: 'knowledge-search', name: 'kb_search', type: 'builtin' },
              status: 'done',
              arguments: { query: 'Cherry Studio', baseIds: ['base-1'] },
              response: ''
            } as NormalToolResponse
          }
        />
      </ToolResultLoadProvider>
    )

    expect(screen.getByRole('button')).toHaveTextContent('Cherry Studio')
    expect(screen.queryByText('0 search results')).not.toBeInTheDocument()
  })

  it('does not infer a deferred payload from an empty response', () => {
    render(
      <MessageKnowledgeSearchToolTitle
        toolResponse={
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'knowledge-search', name: 'kb_search', type: 'builtin' },
            status: 'done',
            arguments: { query: 'Cherry Studio', baseIds: ['base-1'] },
            response: ''
          } as NormalToolResponse
        }
      />
    )

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('0 search results')).toBeInTheDocument()
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
