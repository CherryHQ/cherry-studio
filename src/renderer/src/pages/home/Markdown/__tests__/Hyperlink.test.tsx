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
  )
}))

vi.mock('antd', () => ({
  Popover: mocks.Popover
}))

vi.mock('@renderer/components/Icons/FallbackFavicon', () => ({
  default: mocks.Favicon
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
    expect(screen.getByTestId('popover-content')).toHaveTextContent('https://domain.com/a b')
  })

  it('should not render favicon when URL parsing fails (invalid url)', () => {
    render(
      <Hyperlink href="not%2Furl">
        <span>child</span>
      </Hyperlink>
    )

    // decodeURIComponent succeeds => "not/url" is displayed
    expect(screen.queryByTestId('favicon')).toBeNull()
    expect(screen.getByTestId('popover-content')).toHaveTextContent('not/url')
  })

  it('should not render favicon for non-http(s) scheme without hostname (mailto:)', () => {
    render(
      <Hyperlink href="mailto:test%40example.com">
        <span>child</span>
      </Hyperlink>
    )

    // Decoded to mailto:test@example.com, hostname is empty => no favicon
    expect(screen.queryByTestId('favicon')).toBeNull()
    expect(screen.getByTestId('popover-content')).toHaveTextContent('mailto:test@example.com')
  })
})
