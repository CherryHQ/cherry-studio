import { MarkdownHostContext } from '@renderer/hooks/useMarkdownHost'
import { openFileTarget } from '@renderer/utils/openFileTarget'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Link from '../Link'

const mocks = vi.hoisted(() => ({
  parseJSON: vi.fn(),
  findCitationInChildren: vi.fn(),
  Favicon: ({ hostname, alt }: { hostname: string; alt: string }) => (
    <span data-testid="favicon" data-hostname={hostname} data-alt={alt} />
  ),
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

vi.mock('@renderer/components/icons/FallbackFavicon', () => ({
  __esModule: true,
  default: mocks.Favicon
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
    expect(anchor).toHaveClass('text-primary')
    expect(anchor).not.toHaveClass('inline-flex')

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
    expect(anchor).toHaveClass('text-primary', 'hover:underline')
    expect(anchor).not.toHaveClass('inline-flex')
    expect(screen.getByTestId('favicon')).toHaveAttribute('data-hostname', 'domain.com')
    expect(screen.getByTestId('favicon').parentElement).toHaveClass('markdown-link-favicon', 'mr-1')
  })

  it('should not inject another favicon when children already include one', () => {
    const ExistingFavicon = mocks.Favicon
    render(
      <Link href="https://domain.com/path" className="flex items-center gap-2">
        <ExistingFavicon hostname="domain.com" alt="Domain" />
        <span>Domain</span>
      </Link>
    )

    expect(screen.getAllByTestId('favicon')).toHaveLength(1)
    expect(screen.getByRole('link')).toHaveClass('text-primary', 'flex', 'gap-2')
    expect(screen.getByRole('link')).not.toHaveClass('hover:underline')
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

  it('should route a file-path link to the host opener, keeping its text and not navigating', () => {
    mocks.findCitationInChildren.mockReturnValue(undefined)
    mocks.parseJSON.mockReturnValue(undefined)
    const openFilePath = vi.fn()
    const onParentClick = vi.fn()

    const { container } = render(
      <MarkdownHostContext value={{ openFilePath }}>
        <div onClick={onParentClick}>
          <Link href=".agents/skills/gh-create-pr/SKILL.md">the skill file</Link>
        </div>
      </MarkdownHostContext>
    )

    // Not a web link: no Hyperlink wrapper, no new-window target.
    expect(screen.queryByTestId('hyperlink')).toBeNull()
    const anchor = container.querySelector('a') as HTMLAnchorElement
    expect(anchor).toHaveTextContent('the skill file')
    expect(anchor.getAttribute('target')).toBeNull()

    fireEvent.click(anchor)
    expect(openFilePath).toHaveBeenCalledWith('.agents/skills/gh-create-pr/SKILL.md')
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('should not intercept web links even when a file opener is available', () => {
    mocks.findCitationInChildren.mockReturnValue(undefined)
    mocks.parseJSON.mockReturnValue(undefined)
    const openFilePath = vi.fn()

    render(
      <MarkdownHostContext value={{ openFilePath }}>
        <Link href="https://domain.com/path">Open</Link>
      </MarkdownHostContext>
    )

    expect(screen.getByTestId('hyperlink')).toBeInTheDocument()
    expect(openFilePath).not.toHaveBeenCalled()
  })

  it('should treat a file-path href as a normal link when no host opener is provided', () => {
    mocks.findCitationInChildren.mockReturnValue(undefined)
    mocks.parseJSON.mockReturnValue(undefined)

    render(<Link href="docs/guide.md">Guide</Link>)

    // No host → the existing Hyperlink behavior is preserved (no regression).
    expect(screen.getByTestId('hyperlink')).toBeInTheDocument()
  })

  it('should hand a relative file-path link to the opener to join with the workspace', () => {
    mocks.findCitationInChildren.mockReturnValue(undefined)
    mocks.parseJSON.mockReturnValue(undefined)
    const openFilePath = vi.fn()

    const { container } = render(
      <MarkdownHostContext value={{ openFilePath }}>
        <Link href="./DESIGN.md">Design</Link>
      </MarkdownHostContext>
    )

    expect(screen.queryByTestId('hyperlink')).toBeNull()
    fireEvent.click(container.querySelector('a') as HTMLAnchorElement)
    // The opener (workspace-aware) receives the raw relative path.
    expect(openFilePath).toHaveBeenCalledWith('./DESIGN.md')
  })

  // The link-boundary parser must strip URL hash/query and decode percent-encoding,
  // and must accept single-segment names that `isInlineFilePath` would reject.
  it.each([
    ['./README.md#安装', './README.md'],
    ['./Meeting%20Notes.md', './Meeting Notes.md'],
    ['README.md', 'README.md'],
    ['./src/', './src/']
  ])('parses file-link href %s → opens %s', (href, expected) => {
    mocks.findCitationInChildren.mockReturnValue(undefined)
    mocks.parseJSON.mockReturnValue(undefined)
    const openFilePath = vi.fn()

    const { container } = render(
      <MarkdownHostContext value={{ openFilePath }}>
        <Link href={href}>link</Link>
      </MarkdownHostContext>
    )

    fireEvent.click(container.querySelector('a') as HTMLAnchorElement)
    expect(openFilePath).toHaveBeenCalledWith(expected)
  })

  it('routes the parsed path through the host opener: file → preview, directory → file manager, failure → error', async () => {
    mocks.findCitationInChildren.mockReturnValue(undefined)
    mocks.parseJSON.mockReturnValue(undefined)

    const openArtifactFile = vi.fn()
    const openPath = vi.fn()
    const onError = vi.fn()
    const isDirectory = vi.fn().mockResolvedValue(false)
    const host = {
      openFilePath: (path: string) => openFileTarget(path, { openArtifactFile, openPath, isDirectory, onError })
    }

    const { container, rerender } = render(
      <MarkdownHostContext value={host}>
        <Link href="./README.md">readme</Link>
      </MarkdownHostContext>
    )
    fireEvent.click(container.querySelector('a') as HTMLAnchorElement)
    await waitFor(() => expect(openArtifactFile).toHaveBeenCalledWith('./README.md'))
    expect(openPath).not.toHaveBeenCalled()

    isDirectory.mockResolvedValue(true)
    rerender(
      <MarkdownHostContext value={host}>
        <Link href="./src/">src</Link>
      </MarkdownHostContext>
    )
    fireEvent.click(container.querySelector('a') as HTMLAnchorElement)
    await waitFor(() => expect(openPath).toHaveBeenCalledWith('./src/'))

    isDirectory.mockResolvedValue(false)
    openArtifactFile.mockRejectedValueOnce(new Error('boom'))
    rerender(
      <MarkdownHostContext value={host}>
        <Link href="./x.md">x</Link>
      </MarkdownHostContext>
    )
    fireEvent.click(container.querySelector('a') as HTMLAnchorElement)
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
  })
})
