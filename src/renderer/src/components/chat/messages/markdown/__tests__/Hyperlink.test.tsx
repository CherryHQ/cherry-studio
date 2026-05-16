import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Hyperlink from '../Hyperlink'

const mocks = vi.hoisted(() => ({
  Favicon: ({ hostname, alt }: { hostname: string; alt: string }) => (
    <img data-testid="favicon" data-hostname={hostname} alt={alt} />
  ),
  useMetaDataParser: vi.fn(() => ({
    metadata: {},
    isLoading: false,
    isLoaded: true,
    parseMetadata: vi.fn()
  }))
}))

vi.mock('@renderer/components/Icons/FallbackFavicon', () => ({
  __esModule: true,
  default: mocks.Favicon
}))

vi.mock('@renderer/hooks/useMetaDataParser', () => ({
  useMetaDataParser: mocks.useMetaDataParser
}))

vi.mock('@cherrystudio/ui', () => {
  const React = require('react')
  const PopoverContext = React.createContext({ open: false, onOpenChange: undefined })

  return {
    Popover: ({ children, open = false, onOpenChange, ...props }) =>
      React.createElement(
        PopoverContext.Provider,
        { value: { open, onOpenChange } },
        React.createElement('div', { ...props, 'data-testid': 'popover' }, children)
      ),
    PopoverTrigger: ({ children, asChild, ...props }) => {
      if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children, { ...props, 'data-testid': 'popover-trigger' })
      }
      return React.createElement('div', { ...props, 'data-testid': 'popover-trigger' }, children)
    },
    PopoverContent: ({ children, ...props }) => {
      const context = React.use(PopoverContext)
      return context.open ? React.createElement('div', { ...props, 'data-testid': 'popover-content' }, children) : null
    }
  }
})

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
        <div data-testid="title">{hostname}</div>
        <div data-testid="text">{link}</div>
      </div>
    )
  }
}))

describe('Hyperlink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
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
    fireEvent.mouseEnter(screen.getByTestId('popover-trigger'))
    expect(screen.getByTestId('popover-content')).toHaveClass('overflow-hidden rounded-lg p-0')

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

    fireEvent.mouseEnter(screen.getByTestId('popover-trigger'))

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

    fireEvent.mouseEnter(screen.getByTestId('popover-trigger'))

    // Decoded to mailto:test@example.com, hostname is empty => no favicon
    expect(screen.queryByTestId('favicon')).toBeNull()
    // Since there's no hostname and no og:title, title shows empty, but text shows the decoded URL
    expect(screen.getByTestId('title')).toBeEmptyDOMElement()
    expect(screen.getByTestId('text')).toHaveTextContent('mailto:test@example.com')
  })

  it('should open the popover when hovering the link trigger', () => {
    render(
      <Hyperlink href="https://domain.com/a%20b">
        <span>child</span>
      </Hyperlink>
    )

    expect(screen.queryByTestId('popover-content')).toBeNull()

    fireEvent.mouseEnter(screen.getByTestId('popover-trigger'))

    expect(screen.getByTestId('popover-content')).toBeInTheDocument()
  })

  it('should stay open when moving from the trigger to the popover content and close after leaving content', () => {
    vi.useFakeTimers()

    render(
      <Hyperlink href="https://domain.com/a%20b">
        <span>child</span>
      </Hyperlink>
    )

    fireEvent.mouseEnter(screen.getByTestId('popover-trigger'))
    const content = screen.getByTestId('popover-content')

    fireEvent.mouseLeave(screen.getByTestId('popover-trigger'))
    fireEvent.mouseEnter(content)

    act(() => {
      vi.advanceTimersByTime(120)
    })

    expect(screen.getByTestId('popover-content')).toBeInTheDocument()

    fireEvent.mouseLeave(screen.getByTestId('popover-content'))

    act(() => {
      vi.advanceTimersByTime(120)
    })

    expect(screen.queryByTestId('popover-content')).toBeNull()
  })
})
