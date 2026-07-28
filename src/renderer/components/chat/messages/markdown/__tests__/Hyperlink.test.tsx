import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Hyperlink from '../Hyperlink'

const mocks = vi.hoisted(() => ({
  Favicon: ({ hostname, alt }: { hostname: string; alt: string }) => (
    <img data-testid="favicon" data-hostname={hostname} alt={alt} />
  ),
  hoverCardOpenChange: { current: undefined as ((open: boolean) => void) | undefined },
  hoverCardProps: [] as Array<{ openDelay?: number; closeDelay?: number }>,
  ogCardProps: [] as Array<{ link: string; show: boolean }>,
  useMetaDataParser: vi.fn(() => ({
    metadata: {},
    isLoading: false,
    isLoaded: true,
    parseMetadata: vi.fn()
  }))
}))

vi.mock('@renderer/components/icons/FallbackFavicon', () => ({
  __esModule: true,
  default: mocks.Favicon
}))

vi.mock('@renderer/hooks/useMetaDataParser', () => ({
  useMetaDataParser: mocks.useMetaDataParser
}))

vi.mock('@cherrystudio/ui', () => {
  const React = require('react')

  return {
    HoverCard: ({ children, openDelay, closeDelay, onOpenChange, ...props }) => {
      mocks.hoverCardProps.push({ openDelay, closeDelay })
      mocks.hoverCardOpenChange.current = onOpenChange
      return React.createElement('div', { ...props, 'data-testid': 'hover-card' }, children)
    },
    HoverCardTrigger: ({ children, asChild, ...props }) => {
      void asChild
      return React.createElement('div', { ...props, 'data-testid': 'hover-card-trigger' }, children)
    },
    HoverCardContent: ({ children, sideOffset, ...props }) => {
      void sideOffset
      return React.createElement('div', { ...props, 'data-testid': 'hover-card-content' }, children)
    }
  }
})

// Mock the OgCard component
vi.mock('@renderer/components/OgCard', () => ({
  OgCard: ({ link, show }: { link: string; show: boolean }) => {
    mocks.ogCardProps.push({ link, show })
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
    mocks.hoverCardOpenChange.current = undefined
    mocks.hoverCardProps.length = 0
    mocks.ogCardProps.length = 0
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
    expect(screen.queryByTestId('hover-card')).toBeNull()
    expect(screen.getByText('Only Child')).toBeInTheDocument()
  })

  it('should decode href and show favicon when hostname exists', () => {
    render(
      <Hyperlink href="https://domain.com/a%20b">
        <span>child</span>
      </Hyperlink>
    )

    expect(screen.getByTestId('hover-card')).toBeInTheDocument()
    expect(screen.getByTestId('hover-card-content')).toHaveClass('w-auto max-w-none overflow-hidden rounded-lg p-0')

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

  it('should configure the hover card with a 1.5 second open delay', () => {
    render(
      <Hyperlink href="https://domain.com/a%20b">
        <span>child</span>
      </Hyperlink>
    )

    expect(mocks.hoverCardProps.at(-1)).toEqual({
      openDelay: 1500,
      closeDelay: 100
    })
  })

  it('should defer metadata loading until the hover card opens', () => {
    render(
      <Hyperlink href="https://domain.com/a%20b">
        <span>child</span>
      </Hyperlink>
    )

    expect(mocks.ogCardProps.at(-1)).toMatchObject({ show: false })

    act(() => {
      mocks.hoverCardOpenChange.current?.(true)
    })

    expect(mocks.ogCardProps.at(-1)).toMatchObject({ show: true })
  })
})
