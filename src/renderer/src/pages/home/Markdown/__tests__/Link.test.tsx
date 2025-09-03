import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Link from '../Link'

const mocks = vi.hoisted(() => ({
  parseJSON: vi.fn(),
  findCitationInChildren: vi.fn(),
  CitationTooltip: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="citation-tooltip">{children}</div>
  ),
  CitationSchema: {
    safeParse: vi.fn((input: any) => ({ success: !!input, data: input }))
  },
  Hyperlink: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <div data-testid="hyperlink" data-href={href}>
      {children}
    </div>
  )
}))

vi.mock('@renderer/utils/json', () => ({
  parseJSON: mocks.parseJSON
}))

vi.mock('@renderer/utils/markdown', () => ({
  findCitationInChildren: mocks.findCitationInChildren
}))

vi.mock('../CitationTooltip', () => ({
  default: mocks.CitationTooltip,
  CitationSchema: mocks.CitationSchema
}))

vi.mock('../Hyperlink', () => ({
  default: mocks.Hyperlink
}))

describe('Link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should match snapshot', () => {
    const { container } = render(<Link href="https://example.com">Example</Link>)
    expect(container).toMatchSnapshot()
  })

  it('should render internal anchor as span.link and no <a>', () => {
    const { container } = render(<Link href="#section-1">Go to section</Link>)
    expect(container.querySelector('span.link')).not.toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(screen.getByText('Go to section')).toBeInTheDocument()
  })

  it('should wrap with CitationTooltip when children include <sup> and citation data exists', () => {
    mocks.findCitationInChildren.mockReturnValue('{"title":"ref"}')
    mocks.parseJSON.mockReturnValue({ title: 'ref' })

    const onParentClick = vi.fn()
    const { container } = render(
      <div onClick={onParentClick}>
        <Link href="https://example.com">
          <span>ref</span>
          <sup>1</sup>
        </Link>
      </div>
    )

    expect(screen.getByTestId('citation-tooltip')).toBeInTheDocument()

    const anchor = container.querySelector('a') as HTMLAnchorElement
    expect(anchor).not.toBeNull()
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(anchor.getAttribute('rel')).toBe('noreferrer')

    fireEvent.click(anchor)
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('should fall back to Hyperlink when <sup> exists but citation data is null', () => {
    mocks.findCitationInChildren.mockReturnValue('{"title":"ref"}')
    mocks.parseJSON.mockReturnValue(null)

    render(
      <Link href="https://example.com">
        <span>text</span>
        <sup>1</sup>
      </Link>
    )

    expect(screen.getByTestId('hyperlink')).toBeInTheDocument()
    expect(screen.queryByTestId('citation-tooltip')).toBeNull()
  })

  it('should render normal external link inside Hyperlink when not a citation', () => {
    mocks.findCitationInChildren.mockReturnValue(undefined)
    mocks.parseJSON.mockReturnValue(undefined)

    const { container } = render(<Link href="https://domain.com/path">Open</Link>)

    const wrapper = screen.getByTestId('hyperlink')
    expect(wrapper).toBeInTheDocument()
    expect(wrapper).toHaveAttribute('data-href', 'https://domain.com/path')

    const anchor = container.querySelector('a') as HTMLAnchorElement
    expect(anchor.getAttribute('href')).toBe('https://domain.com/path')
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(anchor.getAttribute('rel')).toBe('noreferrer')
  })

  it('should omit empty href for citation link (no href attribute when href="")', () => {
    mocks.findCitationInChildren.mockReturnValue('{"title":"ref"}')
    mocks.parseJSON.mockReturnValue({ title: 'ref' })

    const { container } = render(
      <Link href="">
        text<sup>2</sup>
      </Link>
    )

    const anchor = container.querySelector('a') as HTMLAnchorElement
    expect(anchor).not.toBeNull()
    expect(anchor.hasAttribute('href')).toBe(false)
  })
})
