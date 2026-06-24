import type { NormalToolResponse } from '@renderer/types'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import { MessageWebSearchToolTitle } from '../MessageWebSearch'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, params?: Record<string, number>) => {
        if (key === 'message.websearch.fetch_empty') return 'No search results found'
        if (key === 'message.websearch.fetch_complete') return `${params?.count} search results`
        return key
      }
    })
  }
})

// Favicon fetches remote icons on mount; stub it so the test stays offline and we can assert the hostname.
vi.mock('@renderer/components/Icons/FallbackFavicon', () => ({
  default: ({ hostname, alt }: { hostname: string; alt: string }) => (
    <span data-testid="favicon" data-hostname={hostname} aria-label={alt} />
  )
}))

describe('MessageWebSearchToolTitle', () => {
  it('shows the query and an empty-result label without a disclosure', () => {
    render(
      <MessageWebSearchToolTitle
        toolResponse={
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'web-search', name: 'web_search', type: 'builtin' },
            status: 'done',
            arguments: { query: 'Cherry Studio' },
            response: []
          } as NormalToolResponse
        }
      />
    )

    expect(screen.getByText('Cherry Studio')).toBeInTheDocument()
    expect(screen.getByText('No search results found')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('uses the compact tool-row text while searching', () => {
    render(
      <MessageWebSearchToolTitle
        toolResponse={
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'web-search', name: 'web_search', type: 'builtin' },
            status: 'invoking',
            arguments: { query: 'Cherry Studio' },
            response: []
          } as NormalToolResponse
        }
      />
    )

    const searchingText = screen.getByText('message.searching').closest('span')
    expect(searchingText).toHaveClass('py-0.5 text-[13px] leading-5')
    expect(screen.getByText('Cherry Studio')).toHaveClass('truncate')
  })

  it('shows the query in the header and renders each result as a link with favicon and domain', async () => {
    render(
      <MessageWebSearchToolTitle
        toolResponse={
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'web-search', name: 'web_search', type: 'builtin' },
            status: 'done',
            arguments: { query: 'Cherry Studio' },
            response: [
              { id: 1, title: 'Cherry Studio', url: 'https://www.cherry-ai.com/blog', content: 'Cherry Studio' }
            ]
          } as NormalToolResponse
        }
      />
    )

    // Header shows the query + the result count (collapse body is not rendered yet).
    const header = screen.getByRole('button')
    expect(within(header).getByText('Cherry Studio')).toBeInTheDocument()
    expect(within(header).getByText('1 search results')).toBeInTheDocument()

    fireEvent.click(header)

    expect(screen.getByTestId('collapse-content-tool-call-1')).toHaveClass('rounded-xl bg-muted px-4 py-3')
    const link = await screen.findByRole('link')
    expect(link).toHaveAttribute('href', 'https://www.cherry-ai.com/blog')
    expect(screen.getByTestId('favicon')).toHaveAttribute('data-hostname', 'www.cherry-ai.com')
    expect(screen.getByText('cherry-ai.com')).toBeInTheDocument()
  })
})
