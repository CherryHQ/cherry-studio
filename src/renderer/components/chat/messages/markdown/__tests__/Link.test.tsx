import type { Citation } from '@renderer/types/message'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Element } from 'hast'
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

const imageLinkNode = {
  type: 'element',
  tagName: 'a',
  properties: { href: 'https://domain.com' },
  children: [
    {
      type: 'element',
      tagName: 'img',
      properties: { alt: 'Badge', src: 'https://domain.com/badge.svg' },
      children: []
    }
  ]
} as Element

const bareUrlNode = {
  type: 'element',
  tagName: 'a',
  properties: { href: 'https://domain.com/a/very/long/path' },
  children: [{ type: 'text', value: 'https://domain.com/a/very/long/path' }]
} as Element

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

  it('keeps image links free of orphaned favicons', () => {
    render(
      <Link href="https://domain.com" node={imageLinkNode}>
        <img alt="Badge" src="https://domain.com/badge.svg" />
      </Link>
    )

    expect(screen.getByRole('link', { name: 'Badge' })).toBeInTheDocument()
    expect(screen.queryByTestId('favicon')).not.toBeInTheDocument()
  })

  it('lets a bare URL wrap without a leading favicon', () => {
    render(
      <Link href="https://domain.com/a/very/long/path" node={bareUrlNode}>
        https://domain.com/a/very/long/path
      </Link>
    )

    expect(screen.getByRole('link', { name: 'https://domain.com/a/very/long/path' })).toBeInTheDocument()
    expect(screen.queryByTestId('favicon')).not.toBeInTheDocument()
  })
})

describe('Link file-path opener', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findCitationInChildren.mockReturnValue(undefined)
  })

  it('routes a schemeless file-path link to the opener without navigating', () => {
    const openFilePath = vi.fn()
    const onParentClick = vi.fn()
    const { container } = render(
      <div onClick={onParentClick}>
        <Link href="./DESIGN.md" openFilePath={openFilePath}>
          Design
        </Link>
      </div>
    )

    // Not a web link: no Hyperlink wrapper, no new-window target.
    expect(screen.queryByTestId('hyperlink')).toBeNull()
    const anchor = container.querySelector('a') as HTMLAnchorElement
    expect(anchor.getAttribute('target')).toBeNull()
    expect(anchor).toHaveClass('text-link')

    const clickEvent = createEvent.click(anchor)
    fireEvent(anchor, clickEvent)

    expect(clickEvent.defaultPrevented).toBe(true)
    expect(onParentClick).not.toHaveBeenCalled()
    expect(openFilePath).toHaveBeenCalledWith('./DESIGN.md')
  })

  it('does not intercept web links even when an opener is provided', () => {
    const openFilePath = vi.fn()
    render(
      <Link href="https://domain.com/path" openFilePath={openFilePath}>
        Open
      </Link>
    )

    expect(screen.getByTestId('hyperlink')).toBeInTheDocument()
    expect(openFilePath).not.toHaveBeenCalled()
  })

  it('treats a file-path href as a normal link when no opener is provided', () => {
    render(<Link href="docs/guide.md">Guide</Link>)

    // No opener → the existing Hyperlink behavior is preserved (no regression).
    expect(screen.getByTestId('hyperlink')).toBeInTheDocument()
  })
})
