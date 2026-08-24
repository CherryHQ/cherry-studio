import type { Citation } from '@renderer/types/message'
import { fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CitationsList from '../CitationsList'

const mocks = vi.hoisted(() => ({
  openCitationsPanel: vi.fn(),
  messageListActions: undefined as { openCitationsPanel?: ReturnType<typeof vi.fn> } | undefined
}))

vi.mock('../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => mocks.messageListActions
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  )
}))

vi.mock('@renderer/components/icons/FallbackFavicon', () => ({
  default: ({ alt }: { alt?: string }) => <span>{alt}</span>
}))

vi.mock('lucide-react', () => ({
  Check: () => <span>check</span>,
  Copy: () => <span>copy</span>,
  FileSearch: () => <span>file</span>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { count?: number }) => (key === 'message.citation' ? `${params?.count} citations` : key)
  })
}))

describe('CitationsList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.messageListActions = { openCitationsPanel: mocks.openCitationsPanel }
  })

  it('opens the page side panel with the current citations', () => {
    const citations: Citation[] = [
      { number: 1, url: 'https://example.com', title: 'Example', type: 'websearch' },
      { number: 2, url: '/tmp/doc.md', title: 'doc.md', type: 'knowledge' }
    ]

    render(<CitationsList citations={citations} />)

    fireEvent.click(screen.getByRole('button', { name: /2 citations/i }))

    expect(mocks.openCitationsPanel).toHaveBeenCalledTimes(1)
    expect(mocks.openCitationsPanel).toHaveBeenCalledWith({ citations })
  })

  it('renders a knowledge citation with the document icon instead of a favicon', () => {
    const citations: Citation[] = [{ number: 1, url: '', title: 'doc.md', type: 'knowledge' }]

    render(<CitationsList citations={citations} />)

    expect(screen.getByText('file')).toBeInTheDocument()
  })
})
