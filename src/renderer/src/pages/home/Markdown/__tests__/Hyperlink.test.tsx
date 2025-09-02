import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Hyperlink from '../Hyperlink'

// 3.1: 使用 vi.hoisted 集中管理模拟
const mocks = vi.hoisted(() => ({
  Popover: ({ children, content, arrow, placement, color, styles }: any) => (
    <div
      data-testid="popover"
      data-arrow={String(arrow)}
      data-placement={placement}
      data-color={color}
      data-styles={JSON.stringify(styles)}>
      <div data-testid="popover-content">{content}</div>
      <div data-testid="popover-children">{children}</div>
    </div>
  ),
  Favicon: ({ hostname, alt }: { hostname: string; alt: string }) => (
    <img data-testid="favicon" data-hostname={hostname} alt={alt} />
  ),
  Typography: {
    Title: ({ children }: { children: React.ReactNode }) => <div data-testid="title">{children}</div>,
    Text: ({ children }: { children: React.ReactNode }) => <div data-testid="text">{children}</div>
  },
  Skeleton: () => <div data-testid="skeleton">Loading...</div>,
  useMetaDataParser: vi.fn(() => ({
    metadata: {},
    isLoading: false,
    isLoaded: true,
    parseMetadata: vi.fn()
  }))
}))

vi.mock('antd', () => ({
  Popover: mocks.Popover,
  Typography: mocks.Typography,
  Skeleton: mocks.Skeleton
}))

vi.mock('@renderer/components/Icons/FallbackFavicon', () => ({
  __esModule: true,
  default: mocks.Favicon
}))

vi.mock('@renderer/hooks/useMetaDataParser', () => ({
  useMetaDataParser: mocks.useMetaDataParser
}))

// Mock the OGCard component
vi.mock('@renderer/components/OGCard', () => ({
  OGCard: ({ link }: { link: string; show: boolean }) => {
    let hostname = ''
    try {
      hostname = new URL(link).hostname
    } catch (e) {
      // Ignore invalid URLs
    }

    return (
      <div data-testid="og-card">
        {hostname && <mocks.Favicon hostname={hostname} alt={link} />}
        <mocks.Typography.Title>{hostname}</mocks.Typography.Title>
        <mocks.Typography.Text>{link}</mocks.Typography.Text>
      </div>
    )
  }
}))

describe('Hyperlink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should match snapshot for normal url', () => {
    const { container } = render(
      <Hyperlink href="https://example.com/path%20with%20space">
        <span>Child</span>
      </Hyperlink>
    )
    expect(container).toMatchSnapshot()
  })

  it('should return children directly when href is empty', () => {
    render(
      <Hyperlink href="">
        <span>Only Child</span>
      </Hyperlink>
    )
    expect(screen.queryByTestId('popover')).toBeNull()
    expect(screen.getByText('Only Child')).toBeInTheDocument()
  })

  it('should decode href and show favicon when hostname exists', () => {
    render(
      <Hyperlink href="https://domain.com/a%20b">
        <span>child</span>
      </Hyperlink>
    )

    // Popover wrapper exists
    const popover = screen.getByTestId('popover')
    expect(popover).toBeInTheDocument()
    expect(popover).toHaveAttribute('data-arrow', 'false')
    expect(popover).toHaveAttribute('data-placement', 'top')

    // Content includes decoded url text and favicon with hostname
    expect(screen.getByTestId('favicon')).toHaveAttribute('data-hostname', 'domain.com')
    expect(screen.getByTestId('favicon')).toHaveAttribute('alt', 'https://domain.com/a b')
    // The title should show hostname and text should show the full URL
    expect(screen.getByTestId('title')).toHaveTextContent('domain.com')
    expect(screen.getByTestId('text')).toHaveTextContent('https://domain.com/a b')
  })

  it('should not render favicon when URL parsing fails (invalid url)', () => {
    render(
      <Hyperlink href="not%2Furl">
        <span>child</span>
      </Hyperlink>
    )

    // decodeURIComponent succeeds => "not/url" is displayed
    expect(screen.queryByTestId('favicon')).toBeNull()
    // Since there's no hostname and no og:title, title shows empty, but text shows the URL
    expect(screen.getByTestId('title')).toBeEmptyDOMElement()
    expect(screen.getByTestId('text')).toHaveTextContent('not/url')
  })

  it('should not render favicon for non-http(s) scheme without hostname (mailto:)', () => {
    render(
      <Hyperlink href="mailto:test%40example.com">
        <span>child</span>
      </Hyperlink>
    )

    // Decoded to mailto:test@example.com, hostname is empty => no favicon
    expect(screen.queryByTestId('favicon')).toBeNull()
    // Since there's no hostname and no og:title, title shows empty, but text shows the decoded URL
    expect(screen.getByTestId('title')).toBeEmptyDOMElement()
    expect(screen.getByTestId('text')).toHaveTextContent('mailto:test@example.com')
  })
})
