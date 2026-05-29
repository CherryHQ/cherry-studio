import { render } from '@testing-library/react'
import type React from 'react'
import { describe, expect, it, vi } from 'vitest'

import MiniAppIcon from '../MiniAppIcon'

vi.mock('@renderer/config/miniApps', () => ({
  allMiniApps: [
    {
      id: 'test-app-1',
      name: 'Test App 1',
      logo: '/test-logo-1.png',
      url: 'https://test1.com',
      bordered: true,
      background: '#f0f0f0'
    },
    {
      id: 'test-app-2',
      name: 'Test App 2',
      logo: '/test-logo-2.png',
      url: 'https://test2.com',
      bordered: false,
      background: undefined
    }
  ],
  getMiniAppsLogo: (logo: unknown) => {
    if (logo !== 'compound-logo') return logo
    const CompoundLogo = ({
      'aria-label': ariaLabel,
      className,
      style,
      variant
    }: React.SVGProps<SVGSVGElement> & { variant?: 'light' | 'dark' }) => (
      <svg
        aria-label={ariaLabel}
        className={className}
        data-testid="compound-logo"
        data-variant={variant ?? 'auto'}
        style={style}
      />
    )
    CompoundLogo.Avatar = ({ className, size = 32 }: { className?: string; size?: number }) => (
      <div className={className} data-testid="compound-logo-avatar" style={{ width: size, height: size }}>
        <div data-testid="compound-logo-fallback" data-slot="avatar-fallback">
          <CompoundLogo style={{ width: size * 0.7, height: size * 0.7 }} />
        </div>
      </div>
    )
    CompoundLogo.colorPrimary = '#000000'
    return CompoundLogo
  }
}))

describe('MiniAppIcon', () => {
  const mockApp = {
    appId: 'test-app-1' as any,
    presetMiniAppId: 'test-preset',
    status: 'enabled' as const,
    orderKey: 'a0',
    name: 'Test App',
    url: 'https://test.com',
    logo: '/test-logo-1.png',
    bordered: true,
    background: '#f0f0f0'
  }

  it('should render correctly with various props', () => {
    const customStyle = { marginTop: '10px' }
    const { container } = render(<MiniAppIcon app={mockApp} size={64} style={customStyle} sidebar={true} />)

    const img = container.querySelector('img')
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', '/test-logo-1.png')
    expect(img).toHaveAttribute('alt', 'Test App')
    expect(img).toHaveAttribute('draggable', 'false')
    expect(img).toHaveStyle({
      width: '64px',
      height: '64px',
      marginTop: '10px',
      backgroundColor: '#f0f0f0'
    })
  })

  it('should not apply app.style when sidebar is true', () => {
    const { container } = render(<MiniAppIcon app={mockApp} sidebar={true} />)
    const img = container.querySelector('img')

    expect(img).not.toHaveStyle({
      opacity: '0.8',
      transform: 'scale(1.1)'
    })
  })

  it('should return null when app is not found in allMiniApps', () => {
    const unknownApp = {
      appId: 'unknown-app' as any,
      presetMiniAppId: 'test-preset',
      status: 'enabled' as const,
      orderKey: 'a0',
      name: 'Unknown App',
      url: 'https://unknown.com'
    }
    const { container } = render(<MiniAppIcon app={unknownApp} />)

    expect(container.firstChild).toBeNull()
  })

  it('renders compound icons as avatar by default', () => {
    const { container } = render(<MiniAppIcon app={{ ...mockApp, logo: 'compound-logo' }} size={48} />)

    const avatar = container.querySelector('[data-testid="compound-logo-avatar"]')
    expect(avatar).toBeInTheDocument()
    expect(avatar).toHaveClass('border', 'border-border')
    expect(avatar).not.toHaveClass('[&_[data-slot=avatar-fallback]]:bg-transparent')
  })

  it('renders plain compound icons without avatar chrome', () => {
    const { container } = render(
      <MiniAppIcon app={{ ...mockApp, logo: 'compound-logo' }} appearance="plain" size={48} />
    )

    expect(container.querySelector('[data-testid="compound-logo-avatar"]')).not.toBeInTheDocument()
    expect(container.querySelector('[data-testid="compound-logo"]')).toBeInTheDocument()
  })

  it('preserves direct icon sizing and automatic theme variants in plain mode', () => {
    const { container } = render(
      <MiniAppIcon app={{ ...mockApp, logo: 'compound-logo' }} appearance="plain" size={40} />
    )

    expect(container.querySelector('[data-testid="compound-logo"]')).toHaveAttribute('data-variant', 'auto')
    expect(container.querySelector('[data-testid="compound-logo"]')).toHaveStyle({
      width: '40px',
      height: '40px'
    })
  })
})
