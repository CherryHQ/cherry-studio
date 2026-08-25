import type { NormalToolResponse } from '@renderer/types/mcpTool'
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
        if (key === 'message.websearch.fetch_opaque') return 'Searched by the model'
        if (key === 'message.tools.error') return 'Failed'
        if (key === 'message.websearch.fetch_complete') return `${params?.count} search results`
        if (key === 'message.websearch.budget.truncated.configured_cutoff') {
          return 'Truncated · configured cutoff'
        }
        if (key === 'message.websearch.budget.truncated.hard_limit') return 'Truncated · safety limit'
        if (key === 'message.websearch.budget.omitted.configured_cutoff') return 'Omitted · configured cutoff'
        if (key === 'message.websearch.budget.omitted.hard_limit') return 'Omitted · safety limit'
        return key
      }
    })
  }
})

// Favicon fetches remote icons on mount; stub it so the test stays offline and we can assert the hostname.
vi.mock('@renderer/components/icons/FallbackFavicon', () => ({
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

    const link = await screen.findByRole('link')
    expect(link).toHaveAttribute('href', 'https://www.cherry-ai.com/blog')
    expect(screen.getByTestId('favicon')).toHaveAttribute('data-hostname', 'www.cherry-ai.com')
    expect(screen.getByText('cherry-ai.com')).toBeInTheDocument()
  })

  it('shows why search result content was truncated or omitted', async () => {
    const budgetedResult = (
      id: number,
      status: 'truncated' | 'omitted',
      reason: 'configured_cutoff' | 'hard_limit'
    ) => ({
      id,
      title: `Result ${id}`,
      url: `https://example.com/${id}`,
      content: status === 'omitted' ? '' : 'retained excerpt',
      budget: {
        status,
        reason,
        originalTokens: 100,
        retainedTokens: status === 'omitted' ? 0 : 50,
        originalBytes: 400,
        retainedBytes: status === 'omitted' ? 0 : 200
      }
    })

    render(
      <MessageWebSearchToolTitle
        toolResponse={
          {
            id: 'tool-call-budgeted',
            toolCallId: 'tool-call-budgeted',
            tool: { id: 'web-search', name: 'web_search', type: 'builtin' },
            status: 'done',
            arguments: { query: 'large pages' },
            response: [
              budgetedResult(1, 'truncated', 'configured_cutoff'),
              budgetedResult(2, 'truncated', 'hard_limit'),
              budgetedResult(3, 'omitted', 'configured_cutoff'),
              budgetedResult(4, 'omitted', 'hard_limit')
            ]
          } as NormalToolResponse
        }
      />
    )

    fireEvent.click(screen.getByRole('button'))

    expect(await screen.findByText('Truncated · configured cutoff')).toBeInTheDocument()
    expect(screen.getByText('Truncated · safety limit')).toBeInTheDocument()
    expect(screen.getByText('Omitted · configured cutoff')).toBeInTheDocument()
    expect(screen.getByText('Omitted · safety limit')).toBeInTheDocument()
  })
})

// A provider-native tool can share the `web_search` wire name without sharing our result shape —
// Kimi's formula returns an opaque encrypted payload. Reporting "0 results" for it claimed the
// search found nothing when the model had actually been given results.
describe('MessageWebSearchToolTitle — foreign result shapes', () => {
  const opaque = {
    id: 'call-1',
    tool: { name: 'web_search', type: 'builtin' },
    arguments: { query: 'latest llm models' },
    status: 'done',
    response: '----MOONSHOT ENCRYPTED BEGIN----abc----MOONSHOT ENCRYPTED END----'
  } as unknown as NormalToolResponse

  it('does not claim zero results when the output is not ours to parse', () => {
    render(<MessageWebSearchToolTitle toolResponse={opaque} />)

    expect(screen.getByText('Searched by the model')).toBeTruthy()
    expect(screen.queryByText('No search results found')).toBeNull()
  })

  it('marks a failed call instead of spinning forever', () => {
    render(<MessageWebSearchToolTitle toolResponse={{ ...opaque, status: 'error' } as NormalToolResponse} />)

    expect(screen.getByText('Failed')).toBeTruthy()
  })
})

describe('MessageWebSearchToolTitle — provider-executed Responses actions', () => {
  it('shows the provider search query when the tool input is empty', () => {
    render(
      <MessageWebSearchToolTitle
        toolResponse={
          {
            id: 'provider-search',
            toolCallId: 'provider-search',
            tool: { id: 'provider-search', name: 'webSearch', type: 'provider' },
            status: 'done',
            arguments: {},
            response: { action: { type: 'search', query: 'DeepSeek V4 latest news' } }
          } as NormalToolResponse
        }
      />
    )

    expect(screen.getByText('DeepSeek V4 latest news')).toBeInTheDocument()
    expect(screen.getByText('Searched by the model')).toBeInTheDocument()
  })

  it('shows the opened page URL returned by DeepSeek', () => {
    render(
      <MessageWebSearchToolTitle
        toolResponse={
          {
            id: 'provider-open-page',
            toolCallId: 'provider-open-page',
            tool: { id: 'provider-open-page', name: 'webSearch', type: 'provider' },
            status: 'done',
            arguments: {},
            response: { action: { type: 'openPage', url: 'https://example.com/news' } }
          } as NormalToolResponse
        }
      />
    )

    expect(screen.getByText('https://example.com/news')).toBeInTheDocument()
    expect(screen.getByText('Searched by the model')).toBeInTheDocument()
  })
})
