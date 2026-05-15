import type { Citation } from '@renderer/types'
import { render, screen } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CitationsPanel from '../CitationsPanel'

const mocks = vi.hoisted(() => ({
  citationsPanelContent: vi.fn(),
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
    ) : null
}))

vi.mock('@renderer/components/chat/messages/blocks/CitationsList', () => ({
  CitationsPanelContent: (props: {
    citations: Citation[]
    openPath?: (path: string) => void | Promise<void>
    openExternalUrl?: (url: string) => void | Promise<void>
  }) => {
    mocks.citationsPanelContent(props)
    return <div data-testid="citations-panel-content">{props.citations.length}</div>
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

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

  it('renders citations in a transparent page side panel with a full-height body', () => {
    const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Example', type: 'websearch' }]
    const onClose = vi.fn()

    render(<CitationsPanel open={true} onClose={onClose} citations={citations} />)

    expect(screen.getByTestId('page-side-panel')).toHaveAttribute(
      'data-backdrop-class-name',
      'bg-transparent dark:bg-transparent'
    )
    expect(screen.getByTestId('page-side-panel')).toHaveAttribute(
      'data-body-class-name',
      'flex min-h-0 flex-col space-y-0 overflow-hidden p-0 pb-2'
    )
    expect(screen.getByText('message.citations')).toBeInTheDocument()
    expect(screen.getByLabelText('common.close')).toBeInTheDocument()
    expect(screen.getByTestId('citations-panel-content')).toHaveTextContent('1')

    const contentProps = mocks.citationsPanelContent.mock.calls[0][0]
    expect(contentProps.citations).toBe(citations)

    contentProps.openPath?.('/tmp/example.md')
    expect(mocks.fileOpenPath).toHaveBeenCalledWith('/tmp/example.md')

    contentProps.openExternalUrl?.('https://example.com')
    expect(window.open).toHaveBeenCalledTimes(1)
    expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
  })
})
