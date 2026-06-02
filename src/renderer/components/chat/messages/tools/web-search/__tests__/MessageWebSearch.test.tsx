import type { NormalToolResponse } from '@renderer/types'
import { fireEvent, render, screen } from '@testing-library/react'
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

vi.mock('lucide-react', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    Search: ({ className, size }: { className?: string; size?: number | string }) => (
      <span data-testid="search-icon" data-size={size} className={className} />
    )
  }
})

describe('MessageWebSearchToolTitle', () => {
  it('uses the compact tool-row style for an empty-result label', () => {
    render(
      <MessageWebSearchToolTitle
        toolResponse={
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'web-search', name: 'web__search', type: 'builtin' },
            status: 'done',
            arguments: { query: 'Cherry Studio' },
            response: []
          } as NormalToolResponse
        }
      />
    )

    const title = screen.getByText('No search results found').closest('span')
    expect(title).toHaveClass('flex items-center gap-1.5 py-0.5 text-[13px] leading-5 text-foreground-secondary')
    expect(title).not.toHaveClass('p-1.25')
    expect(title).not.toHaveClass('py-1.25 text-sm')
    expect(screen.getByTestId('search-icon')).toHaveAttribute('data-size', '14')
    expect(screen.getByTestId('search-icon')).toHaveClass('shrink-0 text-foreground-muted')
  })

  it('uses the compact tool-row text while searching', () => {
    render(
      <MessageWebSearchToolTitle
        toolResponse={
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'web-search', name: 'web__search', type: 'builtin' },
            status: 'invoking',
            arguments: { query: 'Cherry Studio' },
            response: []
          } as NormalToolResponse
        }
      />
    )

    const searchingText = screen.getByText('message.searching').closest('span')
    expect(searchingText).toHaveClass('py-0.5 text-[13px] leading-5')
    expect(searchingText).not.toHaveClass('py-1.25 text-sm')
    expect(screen.getByText('Cherry Studio')).toHaveClass('truncate')
  })

  it('wraps result details in the shared disclosure container', async () => {
    render(
      <MessageWebSearchToolTitle
        toolResponse={
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'web-search', name: 'web__search', type: 'builtin' },
            status: 'done',
            arguments: { query: 'Cherry Studio' },
            response: [{ id: 1, title: 'Cherry Studio', url: 'https://cherry-ai.com', content: 'Cherry Studio' }]
          } as NormalToolResponse
        }
      />
    )

    expect(screen.getByText('1 search results')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByTestId('collapse-content-tool-call-1')).toHaveClass('rounded-xl bg-muted px-4 py-3')
    expect(await screen.findByRole('link', { name: 'Cherry Studio' })).toHaveAttribute('href', 'https://cherry-ai.com')
  })
})
