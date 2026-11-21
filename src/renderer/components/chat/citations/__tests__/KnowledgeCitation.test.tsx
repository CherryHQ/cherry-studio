import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Citation } from '@renderer/types/message'

import { KnowledgeCitationCard } from '../KnowledgeCitation'

const mocks = vi.hoisted(() => ({ request: vi.fn(), preview: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.mock('@renderer/components/FilePreview', () => ({
  FilePreview: (props: unknown) => {
    mocks.preview(props)
    return <div data-testid="pdf-preview" />
  }
}))
vi.mock('@cherrystudio/ui', () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <>{children}</> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>
}))
vi.mock('@renderer/components/SelectionContextMenu', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>
}))
vi.mock('../../messages/MessageListProvider', () => ({ useOptionalMessageListActions: () => null }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const citation: Citation = {
  number: 1,
  url: '',
  type: 'knowledge',
  title: 'docs/paper.pdf',
  baseId: 'base1',
  conceptId: 'paper.pdf',
  sourceId: 'kb-evidence',
  page: 2,
  charStart: 5,
  charEnd: 13,
  content: 'evidence'
}

beforeEach(() => vi.clearAllMocks())

describe('traceable knowledge citations', () => {
  it('opens the freshly resolved PDF page and highlights its full excerpt', async () => {
    mocks.request.mockResolvedValue({
      status: 'available',
      filePath: '/tmp/paper.pdf',
      page: 3,
      excerpt: 'current evidence'
    })
    render(<KnowledgeCitationCard citation={citation} />)
    const button = screen.getByRole('button', { name: 'paper.pdf' })
    await waitFor(() => expect(button).not.toBeDisabled())
    fireEvent.click(button)
    await screen.findByTestId('pdf-preview')
    expect(mocks.request).toHaveBeenCalledTimes(2)
    expect(mocks.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filePath: '/tmp/paper.pdf',
        pdfCitation: { page: 3, excerpt: 'current evidence' }
      })
    )
  })

  it.each(['invalid', 'unavailable'])('shows %s instead of stale content and cannot open it', async (status) => {
    mocks.request.mockResolvedValue({ status })
    render(<KnowledgeCitationCard citation={citation} />)
    await screen.findByText(`knowledge.citation.${status}`)
    expect(screen.queryByText('evidence')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'paper.pdf' })).toBeDisabled()
    expect(mocks.preview).not.toHaveBeenCalled()
  })

  it('does not open a source removed between mount and click', async () => {
    mocks.request
      .mockResolvedValueOnce({ status: 'available', filePath: '/tmp/paper.pdf', page: 2, excerpt: 'evidence' })
      .mockResolvedValueOnce({ status: 'unavailable' })
    render(<KnowledgeCitationCard citation={citation} />)
    const button = screen.getByRole('button', { name: 'paper.pdf' })
    await waitFor(() => expect(button).not.toBeDisabled())
    fireEvent.click(button)
    await screen.findByText('knowledge.citation.unavailable')
    expect(mocks.preview).not.toHaveBeenCalled()
  })

  it('renders legacy citations without attempting source resolution', () => {
    render(
      <KnowledgeCitationCard
        citation={{ number: 1, url: '', type: 'knowledge', title: 'old.pdf', content: 'old snippet' }}
      />
    )
    expect(screen.getByText('old.pdf')).toBeInTheDocument()
    expect(screen.getByText('old snippet')).toBeInTheDocument()
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
