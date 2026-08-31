import type { Citation } from '@renderer/types/message'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Link from '../Link'

const mocks = vi.hoisted(() => {
  const navigateToRoute = vi.fn()

  return {
    navigateToRoute,
    messageListActions: { navigateToRoute },
    findCitationInChildren: vi.fn(),
    Favicon: ({ hostname, alt }: { hostname: string; alt: string }) => (
      <span data-testid="favicon" data-hostname={hostname} data-alt={alt} />
    ),
    CitationTooltip: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="citation-tooltip">{children}</div>
    ),
    Hyperlink: ({ children, href }: { children: React.ReactNode; href: string }) => (
      <div data-testid="hyperlink" data-href={href}>
        {children}
      </div>
    )
  }
})

vi.mock('@renderer/utils/markdownLight', () => ({ findCitationInChildren: mocks.findCitationInChildren }))
vi.mock('@renderer/components/icons/FallbackFavicon', () => ({ __esModule: true, default: mocks.Favicon }))
vi.mock('../CitationTooltip', () => ({ default: mocks.CitationTooltip }))
vi.mock('../Hyperlink', () => ({ default: mocks.Hyperlink }))
vi.mock('../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => mocks.messageListActions
}))

const supNode = { children: [{ tagName: 'sup' }] } as never
const CitationSup = ({ children }: { children?: React.ReactNode }) => <sup>{children}</sup>
const citation: Citation = {
  number: 1,
  type: 'websearch',
  url: 'https://example.com',
  title: 'Example'
}

describe('Link', () => {
  beforeEach(() => vi.clearAllMocks())

  it('should render internal anchor as span.link and no <a>', () => {
    const { container } = render(<Link href="#section-1">Go to section</Link>)
    expect(container.querySelector('span.link')).not.toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(screen.getByText('Go to section')).toBeInTheDocument()
  })

  it('renders a Cherry Studio route link as an in-app navigation entry', async () => {
    const user = userEvent.setup()
    render(<Link href="/app/paintings?source=assistant">打开画图功能</Link>)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button'))
    expect(mocks.navigateToRoute).toHaveBeenCalledWith({
      path: '/app/paintings',
      query: { source: 'assistant' }
    })
  })

  it('uses trusted registry data when the opaque id and href agree', () => {
    mocks.findCitationInChildren.mockReturnValue('1')
    const onParentClick = vi.fn()
    const { container } = render(
      <div onClick={onParentClick}>
        <Link href="https://example.com" node={supNode} citationRegistry={new Map([[1, citation]])}>
          <CitationSup>1</CitationSup>
        </Link>
      </div>
    )

    expect(screen.getByTestId('citation-tooltip')).toBeInTheDocument()
    expect(screen.queryByTestId('favicon')).toBeNull()
    const anchor = container.querySelector('a') as HTMLAnchorElement
    expect(anchor).not.toBeNull()
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(anchor.getAttribute('rel')).toBe('noreferrer')
    fireEvent.click(anchor)
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('does not trust an opaque id without a current-message registry entry', () => {
    mocks.findCitationInChildren.mockReturnValue('1')
    render(
      <Link href="https://example.com" node={supNode}>
        <CitationSup>1</CitationSup>
      </Link>
    )

    expect(screen.getByTestId('hyperlink')).toBeInTheDocument()
    expect(screen.queryByTestId('citation-tooltip')).toBeNull()
  })

  it('rejects a citation tooltip when the anchor href disagrees with the registry', () => {
    mocks.findCitationInChildren.mockReturnValue('1')
    render(
      <Link href="https://attacker.example" node={supNode} citationRegistry={new Map([[1, citation]])}>
        <CitationSup>1</CitationSup>
      </Link>
    )

    expect(screen.getByTestId('hyperlink')).toHaveAttribute('data-href', 'https://attacker.example')
    expect(screen.queryByTestId('citation-tooltip')).toBeNull()
  })

  it('compares normalized URL forms for generated citation links', () => {
    mocks.findCitationInChildren.mockReturnValue('1')
    const piped = { ...citation, url: 'https://example.com/path?a=1|b=2' }
    render(
      <Link href="https://example.com/path?a=1%7Cb=2" node={supNode} citationRegistry={new Map([[1, piped]])}>
        <CitationSup>1</CitationSup>
      </Link>
    )
    expect(screen.getByTestId('citation-tooltip')).toBeInTheDocument()
  })

  it('renders normal external links inside Hyperlink with a favicon', () => {
    mocks.findCitationInChildren.mockReturnValue(undefined)
    const { container } = render(<Link href="https://domain.com/path">Open</Link>)

    const wrapper = screen.getByTestId('hyperlink')
    expect(wrapper).toBeInTheDocument()
    expect(wrapper).toHaveAttribute('data-href', 'https://domain.com/path')

    const anchor = container.querySelector('a') as HTMLAnchorElement
    expect(anchor.getAttribute('href')).toBe('https://domain.com/path')
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(anchor.getAttribute('rel')).toBe('noreferrer')
    expect(screen.getByTestId('favicon')).toHaveAttribute('data-hostname', 'domain.com')
  })

  it('does not inject another favicon when children already include one', () => {
    const ExistingFavicon = mocks.Favicon
    render(
      <Link href="https://domain.com/path" className="flex items-center gap-2">
        <ExistingFavicon hostname="domain.com" alt="Domain" />
        <span>Domain</span>
      </Link>
    )

    expect(screen.getAllByTestId('favicon')).toHaveLength(1)
  })
})
