import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CitationTooltip from '../CitationTooltip'

// Mock dependencies
const mockWindowOpen = vi.fn()

vi.mock('@renderer/components/Icons/FallbackFavicon', () => ({
  __esModule: true,
  default: (props: any) => <div data-testid="mock-favicon" {...props} />
}))

vi.mock('antd', () => ({
  Tooltip: ({ children, overlay, title, placement, color, styles, ...props }: any) => (
    <div
      data-testid="tooltip-wrapper"
      data-placement={placement}
      data-color={color}
      data-styles={JSON.stringify(styles)}
      {...props}>
      {children}
      <div data-testid="tooltip-content">{overlay || title}</div>
    </div>
  )
}))

const originalWindowOpen = window.open

describe('CitationTooltip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'open', {
      value: mockWindowOpen,
      writable: true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.open = originalWindowOpen
  })

  // Test data factory
  const createCitationData = (overrides = {}) => ({
    url: 'https://example.com/article',
    title: 'Example Article',
    content: 'This is the article content for testing purposes.',
    ...overrides
  })

  const renderCitationTooltip = (citation: any, children = <span>Trigger</span>) => {
    return render(<CitationTooltip citation={citation}>{children}</CitationTooltip>)
  }

  const expectWindowOpenCalled = (url: string) => {
    expect(mockWindowOpen).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer')
  }

  const getTooltipContent = () => screen.getByTestId('tooltip-content')

  const getCitationHeaderButton = () => screen.getByRole('button', { name: /open .* in new tab/i })
  const getCitationFooterButton = () => screen.getByRole('button', { name: /visit .*/i })
  const getCitationTitle = () => screen.getByRole('heading', { level: 3 })
  const getCitationContent = () => screen.queryByRole('article', { name: /citation content/i })

  describe('basic rendering', () => {
    it('should render children and basic tooltip structure', () => {
      const citation = createCitationData()
      renderCitationTooltip(citation, <span>Click me</span>)

      expect(screen.getByText('Click me')).toBeInTheDocument()
      expect(screen.getByTestId('tooltip-wrapper')).toBeInTheDocument()
      expect(getTooltipContent()).toBeInTheDocument()
    })

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

    it('should pass correct props to Tooltip component', () => {
      const citation = createCitationData()
      renderCitationTooltip(citation)

      const tooltip = screen.getByTestId('tooltip-wrapper')
      expect(tooltip).toHaveAttribute('data-placement', 'top')
      expect(tooltip).toHaveAttribute('data-color', 'var(--color-background)')

      const styles = JSON.parse(tooltip.getAttribute('data-styles') || '{}')
      expect(styles.body).toEqual({
        border: '1px solid var(--color-border)',
        padding: '12px',
        borderRadius: '8px'
      })
    })

    it('should match snapshot', () => {
      const citation = createCitationData()
      const { container } = render(
        <CitationTooltip citation={citation}>
          <span>Test content</span>
        </CitationTooltip>
      )
      expect(container.firstChild).toMatchSnapshot()
    })
  })

  describe('URL processing and hostname extraction', () => {
    it('should extract hostname from valid URLs', () => {
      const testCases = [
        { url: 'https://www.example.com/path/to/page?query=1', expected: 'www.example.com' },
        { url: 'http://test.com', expected: 'test.com' },
        { url: 'https://api.v2.example.com/endpoint', expected: 'api.v2.example.com' },
        { url: 'ftp://files.domain.net', expected: 'files.domain.net' }
      ]

      testCases.forEach(({ url, expected }) => {
        const { unmount } = renderCitationTooltip(createCitationData({ url }))
        expect(screen.getByText(expected)).toBeInTheDocument()
        unmount()
      })
    })

    it('should handle URLs with ports correctly', () => {
      const citation = createCitationData({ url: 'https://localhost:3000/api/data' })
      renderCitationTooltip(citation)

      // URL.hostname strips the port
      expect(screen.getByText('localhost')).toBeInTheDocument()
    })

    it('should fallback to original URL when parsing fails', () => {
      const testCases = ['not-a-valid-url', '', 'http://']

      testCases.forEach((invalidUrl) => {
        const { unmount } = renderCitationTooltip(createCitationData({ url: invalidUrl }))
        const favicon = screen.getByTestId('mock-favicon')
        expect(favicon).toHaveAttribute('hostname', invalidUrl)
        unmount()
      })
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

    it('should handle long content with proper styling', () => {
      const longContent =
        'This is a very long content that should be clamped to three lines using CSS line-clamp property for better visual presentation in the tooltip interface.'
      const citation = createCitationData({ content: longContent })
      renderCitationTooltip(citation)

      const contentElement = screen.getByText(longContent)
      expect(contentElement).toHaveStyle({
        display: '-webkit-box',
        overflow: 'hidden'
      })
    })

    it('should handle special characters in title and content', () => {
      const citation = createCitationData({
        title: 'Article with Special: <>{}[]()&"\'`',
        content: 'Content with chars: <>{}[]()&"\'`'
      })
      renderCitationTooltip(citation)

      expect(screen.getByText('Article with Special: <>{}[]()&"\'`')).toBeInTheDocument()
      expect(screen.getByText('Content with chars: <>{}[]()&"\'`')).toBeInTheDocument()
    })
  })

  describe('user interactions', () => {
    it('should open URL when header is clicked', async () => {
      const user = userEvent.setup()
      const citation = createCitationData({ url: 'https://header-click.com' })
      renderCitationTooltip(citation)

      const header = getCitationHeaderButton()
      await user.click(header)

      expectWindowOpenCalled('https://header-click.com')
    })

    it('should open URL when footer is clicked', async () => {
      const user = userEvent.setup()
      const citation = createCitationData({ url: 'https://footer-click.com' })
      renderCitationTooltip(citation)

      const footer = getCitationFooterButton()
      await user.click(footer)

      expectWindowOpenCalled('https://footer-click.com')
    })

    it('should not trigger click when content area is clicked', async () => {
      const user = userEvent.setup()
      const citation = createCitationData({ content: 'Non-clickable content' })
      renderCitationTooltip(citation)

      const content = screen.getByText('Non-clickable content')
      await user.click(content)

      expect(mockWindowOpen).not.toHaveBeenCalled()
    })

    it('should handle invalid URLs gracefully', async () => {
      const user = userEvent.setup()
      const citation = createCitationData({ url: 'invalid-url' })
      renderCitationTooltip(citation)

      const footer = getCitationFooterButton()
      await user.click(footer)

      expectWindowOpenCalled('invalid-url')
    })
  })

  describe('real-world usage scenarios', () => {
    it('should work with actual citation link structure', () => {
      const citation = createCitationData({
        url: 'https://research.example.com/study',
        title: 'Research Study on AI',
        content:
          'This study demonstrates significant improvements in AI capabilities through novel training methodologies and evaluation frameworks.'
      })

      const citationLink = (
        <a href="https://research.example.com/study" target="_blank" rel="noreferrer">
          <sup>1</sup>
        </a>
      )

      renderCitationTooltip(citation, citationLink)

      // Should display all citation information
      expect(screen.getByText('Research Study on AI')).toBeInTheDocument()
      expect(screen.getByText('research.example.com')).toBeInTheDocument()
      expect(screen.getByText(/This study demonstrates/)).toBeInTheDocument()

      // Should contain the sup element
      expect(screen.getByText('1')).toBeInTheDocument()
    })

    it('should handle truncated content as used in real implementation', () => {
      const fullContent = 'A'.repeat(250) // Longer than typical 200 char limit
      const citation = createCitationData({ content: fullContent })
      renderCitationTooltip(citation)

      expect(screen.getByText(fullContent)).toBeInTheDocument()
    })

    it('should handle missing title with hostname fallback in real scenario', () => {
      const citation = createCitationData({
        url: 'https://docs.python.org/3/library/urllib.html',
        title: undefined, // Common case when title extraction fails
        content: 'urllib.request module documentation for Python 3'
      })
      renderCitationTooltip(citation)

      const titleElement = getCitationTitle()
      expect(titleElement).toHaveTextContent('docs.python.org')
    })
  })

  describe('edge cases', () => {
    it('should handle malformed URLs', () => {
      const malformedUrls = ['http://', 'https://', '://missing-protocol']

      malformedUrls.forEach((url) => {
        expect(() => {
          const { unmount } = renderCitationTooltip(createCitationData({ url }))
          unmount()
        }).not.toThrow()
      })
    })

    it('should handle missing children gracefully', () => {
      const citation = createCitationData()

      expect(() => {
        render(<CitationTooltip citation={citation}>{null}</CitationTooltip>)
      }).not.toThrow()
    })

    it('should handle extremely long URLs without breaking', () => {
      const longUrl = 'https://extremely-long-domain-name.example.com/' + 'a'.repeat(500)
      const citation = createCitationData({ url: longUrl })

      expect(() => {
        renderCitationTooltip(citation)
      }).not.toThrow()
    })
  })

  describe('performance', () => {
    it('should memoize calculations correctly', () => {
      const citation = createCitationData({ url: 'https://memoize-test.com' })
      const { rerender } = renderCitationTooltip(citation)

      expect(screen.getByText('memoize-test.com')).toBeInTheDocument()

      // Re-render with same props should work correctly
      rerender(
        <CitationTooltip citation={citation}>
          <span>Trigger</span>
        </CitationTooltip>
      )
      expect(screen.getByText('memoize-test.com')).toBeInTheDocument()
    })

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
