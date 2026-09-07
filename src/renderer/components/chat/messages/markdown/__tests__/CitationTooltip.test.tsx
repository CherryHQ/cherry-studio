import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CitationTooltip from '../CitationTooltip'

vi.mock('@renderer/utils/fetch', () => ({
  fetchXOEmbed: vi.fn().mockResolvedValue(null),
  isXPostUrl: vi.fn().mockReturnValue(false),
  xOembedKey: (url: string) => `xOembed/${url}`
}))

vi.mock('@renderer/components/icons/FallbackFavicon', () => ({
  __esModule: true,
  default: (props: any) => <div data-testid="mock-favicon" {...props} />
}))

const uiMocks = vi.hoisted(() => ({
  NormalTooltip: vi.fn((rawProps: any) => {
    const { children, title, content, placement, contentProps, ...props } = rawProps
    delete props.showArrow

    return (
      <div data-testid="tooltip-wrapper" data-placement={placement} className={contentProps?.className} {...props}>
        {children}
        <div data-testid="tooltip-content">{content || title}</div>
      </div>
    )
  })
}))

vi.mock('@cherrystudio/ui', () => uiMocks)

describe('CitationTooltip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Test data factory
  const createCitationData = (overrides = {}) => ({
    number: 1,
    url: 'https://example.com/article',
    title: 'Example Article',
    content: 'This is the article content for testing purposes.',
    ...overrides
  })

  const createWrapper = () => {
    return ({ children }: { children: ReactNode }) => (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
    )
  }

  const renderCitationTooltip = (citation: any, children = <span>Trigger</span>) => {
    return render(<CitationTooltip citation={citation}>{children}</CitationTooltip>, { wrapper: createWrapper() })
  }

  const getCitationHeaderLink = () => screen.getByRole('link', { name: /open .* in new tab/i })
  const getCitationFooterLink = () => screen.getByRole('link', { name: /visit .*/i })
  const getCitationTitle = () => screen.getByRole('heading', { level: 3 })
  const getCitationContent = () => screen.queryByRole('article')

  describe('basic rendering', () => {
    it('should render Favicon with correct props', () => {
      const citation = createCitationData({
        url: 'https://example.com',
        title: 'Example Title'
      })
      renderCitationTooltip(citation)

      const favicon = screen.getByTestId('mock-favicon')
      expect(favicon).toHaveAttribute('hostname', 'example.com')
      expect(favicon).toHaveAttribute('alt', 'Example Title')
    })
  })

  describe('URL processing and hostname extraction', () => {
    it('should extract hostname from valid URLs', () => {
      const testCases = [
        { url: 'https://www.example.com/path/to/page?query=1', expected: 'www.example.com' },
        { url: 'http://test.com', expected: 'test.com' },
        { url: 'https://api.v2.example.com/endpoint', expected: 'api.v2.example.com' },
        { url: 'ftp://files.domain.net', expected: 'files.domain.net' },
        { url: 'https://localhost:3000/api/data', expected: 'localhost' }
      ]

      testCases.forEach(({ url, expected }) => {
        const { unmount } = renderCitationTooltip(createCitationData({ url }))
        expect(screen.getByText(expected)).toBeInTheDocument()
        unmount()
      })
    })

    it('should fallback to original URL when parsing fails', () => {
      const testCases = ['not-a-valid-url', 'http://']

      testCases.forEach((invalidUrl) => {
        const { unmount } = renderCitationTooltip(createCitationData({ url: invalidUrl }))
        const favicon = screen.getByTestId('mock-favicon')
        expect(favicon).toHaveAttribute('hostname', invalidUrl)
        expect(getCitationFooterLink()).toHaveAttribute('href', invalidUrl)
        unmount()
      })
    })

    it('should render the knowledge document card when the citation has no URL', () => {
      renderCitationTooltip(createCitationData({ url: '', type: 'knowledge' }))

      expect(screen.queryByTestId('mock-favicon')).not.toBeInTheDocument()
      expect(getCitationTitle()).toHaveTextContent('Example Article')
      expect(getCitationContent()).toBeInTheDocument()
    })

    it('should render children without a tooltip when a URL-less citation has no content', () => {
      renderCitationTooltip({ url: '', type: 'knowledge' }, <span>Bare trigger</span>)

      expect(screen.getByText('Bare trigger')).toBeInTheDocument()
      expect(screen.queryByTestId('tooltip-wrapper')).not.toBeInTheDocument()
    })
  })

  describe('content display and title logic', () => {
    it('should display citation title when provided', () => {
      const citation = createCitationData({ title: 'Custom Article Title' })
      renderCitationTooltip(citation)

      expect(screen.getByText('Custom Article Title')).toBeInTheDocument()
      expect(screen.getByText('example.com')).toBeInTheDocument() // hostname in footer
    })

    it('should fallback to hostname when title is empty or whitespace', () => {
      const testCases = [
        { title: undefined, url: 'https://fallback-test.com' },
        { title: '', url: 'https://empty-title.com' },
        { title: '   ', url: 'https://whitespace-title.com' },
        { title: '\n\t  \n', url: 'https://mixed-whitespace.com' }
      ]

      testCases.forEach(({ title, url }) => {
        const { unmount } = renderCitationTooltip(createCitationData({ title, url }))
        const titleElement = getCitationTitle()
        const expectedHostname = new URL(url).hostname
        expect(titleElement).toHaveTextContent(expectedHostname)
        unmount()
      })
    })

    it('should display content when provided and meaningful', () => {
      const citation = createCitationData({ content: 'Meaningful article content' })
      renderCitationTooltip(citation)

      expect(screen.getByText('Meaningful article content')).toBeInTheDocument()
    })

    it('should not render content section when content is empty or whitespace', () => {
      const testCases = [undefined, null, '', '   ', '\n\t  \n']

      testCases.forEach((content) => {
        const { unmount } = renderCitationTooltip(createCitationData({ content }))
        expect(getCitationContent()).not.toBeInTheDocument()
        unmount()
      })
    })
  })

  describe('user interactions', () => {
    it('should render header as an external URL link', () => {
      const citation = createCitationData({ url: 'https://header-click.com' })
      renderCitationTooltip(citation)

      const header = getCitationHeaderLink()
      expect(header).toHaveAttribute('href', 'https://header-click.com')
      expect(header).toHaveAttribute('target', '_blank')
      expect(header).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('should render footer as an external URL link', () => {
      const citation = createCitationData({ url: 'https://footer-click.com' })
      renderCitationTooltip(citation)

      const footer = getCitationFooterLink()
      expect(footer).toHaveAttribute('href', 'https://footer-click.com')
      expect(footer).toHaveAttribute('target', '_blank')
      expect(footer).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('should render content area without link behavior', () => {
      const citation = createCitationData({ content: 'Non-clickable content' })
      renderCitationTooltip(citation)

      const content = screen.getByText('Non-clickable content')
      expect(content.closest('a')).toBeNull()
    })
  })

  describe('performance', () => {
    it('should update when citation data changes', () => {
      const citation1 = createCitationData({ url: 'https://first.com' })
      const { rerender } = renderCitationTooltip(citation1)

      expect(screen.getByText('first.com')).toBeInTheDocument()

      const citation2 = createCitationData({ url: 'https://second.com' })
      rerender(
        <CitationTooltip citation={citation2}>
          <span>Trigger</span>
        </CitationTooltip>
      )

      expect(screen.getByText('second.com')).toBeInTheDocument()
      expect(screen.queryByText('first.com')).not.toBeInTheDocument()
    })
  })
})
