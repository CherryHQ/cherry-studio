import type { Citation } from '@renderer/types/message'
import { render, screen } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CitationPanelActions } from '../common'

const mocks = vi.hoisted(() => ({
  webCitationCard: vi.fn(),
  knowledgeCitationCard: vi.fn(),
  fileOpenPath: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  PageSidePanel: ({
    open,
    onClose,
    header,
    closeLabel,
    backdropClassName,
    bodyClassName,
    children
  }: {
    open: boolean
    onClose: () => void
    header?: React.ReactNode
    closeLabel?: string
    backdropClassName?: string
    bodyClassName?: string
    children?: React.ReactNode
  }) =>
    open ? (
      <section
        data-testid="page-side-panel"
        data-backdrop-class-name={backdropClassName}
        data-body-class-name={bodyClassName}>
        <div>{header}</div>
        <button type="button" aria-label={closeLabel} onClick={onClose} />
        {children}
      </section>
    ) : null,
  Scrollbar: ({ children }: { children?: React.ReactNode }) => <div data-testid="citations-scrollbar">{children}</div>
}))

vi.mock('../WebCitation', () => ({
  WebCitationCard: (props: { citation: Citation; actions?: CitationPanelActions }) => {
    mocks.webCitationCard(props)
    return <div data-testid="web-citation-card">{props.citation.title}</div>
  }
}))

vi.mock('../KnowledgeCitation', () => ({
  KnowledgeCitationCard: (props: { citation: Citation; actions?: CitationPanelActions }) => {
    mocks.knowledgeCitationCard(props)
    return <div data-testid="knowledge-citation-card">{props.citation.title}</div>
  }
}))

vi.mock('../hooks/useCitationPreview', () => ({
  useCitationPreviewSession: () => ({ load: vi.fn() })
}))

vi.mock('@renderer/components/chat/messages/hooks/useMessagePlatformActions', () => ({
  useMessagePlatformActions: () => ({
    copyText: vi.fn(),
    notifyError: vi.fn()
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import CitationsPanel from '../CitationsPanel'

describe('CitationsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          openPath: mocks.fileOpenPath
        }
      }
    })
    window.open = vi.fn()
  })

  it('renders citations in a page side panel and forwards platform actions', () => {
    const citations: Citation[] = [
      { number: 1, url: 'https://example.com', title: 'Example', type: 'websearch' },
      { number: 2, url: '', title: 'doc.md', type: 'knowledge' }
    ]
    const onClose = vi.fn()

    render(<CitationsPanel open={true} onClose={onClose} citations={citations} />)

    expect(screen.getByText('message.citations')).toBeInTheDocument()
    expect(screen.getByLabelText('common.close')).toBeInTheDocument()
    expect(screen.getByTestId('web-citation-card')).toHaveTextContent('Example')
    expect(screen.getByTestId('knowledge-citation-card')).toHaveTextContent('doc.md')

    const contentProps = mocks.webCitationCard.mock.calls[0][0]
    expect(contentProps.citation).toBe(citations[0])

    contentProps.actions?.openPath?.('/tmp/example.md')
    expect(mocks.fileOpenPath).toHaveBeenCalledWith('/tmp/example.md')

    contentProps.actions?.openExternalUrl?.('https://example.com')
    expect(window.open).toHaveBeenCalledTimes(1)
    expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
  })
})
