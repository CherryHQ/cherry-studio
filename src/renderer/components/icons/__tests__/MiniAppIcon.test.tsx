import { render } from '@testing-library/react'
import type React from 'react'
import { describe, expect, it, vi } from 'vitest'

import MiniAppIcon from '../MiniAppIcon'

// Mirror production: only preset keys resolve to a CompoundIcon; everything else
// (an uploaded logo's `file://` URL) returns undefined and renders as an image.
vi.mock('@renderer/components/icons/miniAppsLogo', () => {
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
  const isPresetKey = (logo: unknown) => logo === 'compound-logo' || logo === 'full-bleed-logo'
  return {
    isMiniAppLogoFullBleed: (logo: unknown) => logo === 'full-bleed-logo',
    getMiniAppLogoScale: () => 0.84,
    getMiniAppsLogoRef: (logo: unknown) =>
      isPresetKey(logo)
        ? { kind: 'provider', key: logo, meta: { id: logo, colorPrimary: '#000000' } }
        : undefined,
    useMiniAppLogo: (logo: unknown) => (isPresetKey(logo) ? CompoundLogo : undefined)
  }
})

describe('MiniAppIcon', () => {
  const baseApp = {
    appId: 'test-app-1' as any,
    presetMiniAppId: 'test-preset',
    status: 'enabled' as const,
    orderKey: 'a0',
    name: 'Test App',
    url: 'https://test.com',
    background: '#f0f0f0'
  }

  it('renders an uploaded logo (main-resolved logoSrc) as an image', () => {
    const customStyle = { marginTop: '10px' }
    const { container } = render(
      <MiniAppIcon app={{ ...baseApp, logoSrc: 'file:///files/abc123.webp' }} size={64} style={customStyle} />
    )

    const img = container.querySelector('img')
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'file:///files/abc123.webp')
    expect(img).toHaveAttribute('alt', 'Test App')
    expect(img).toHaveAttribute('draggable', 'false')
    expect(img).toHaveStyle({
      width: '64px',
      height: '64px',
      marginTop: '10px',
      backgroundColor: '#f0f0f0'
    })
  })

  it('renders logoSrc as an image in bare mode', () => {
    const { container } = render(
      <MiniAppIcon app={{ ...baseApp, logoSrc: 'file:///files/abc123.webp' }} appearance="bare" size={32} />
    )

    expect(container.querySelector('img')).toHaveAttribute('src', 'file:///files/abc123.webp')
  })

  it('renders a pre-resolved url carried on `logo` (sidebar tab) as an image', () => {
    // Sidebar tabs carry a single pre-resolved `logo` and no `logoSrc`.
    const { container } = render(
      <MiniAppIcon app={{ ...baseApp, logo: 'file:///files/tab.webp' }} appearance="bare" size={32} />
    )

    expect(container.querySelector('img')).toHaveAttribute('src', 'file:///files/tab.webp')
  })

  it('returns null when there is neither a logo nor a logoSrc', () => {
    const { container } = render(<MiniAppIcon app={baseApp} />)

    expect(container.firstChild).toBeNull()
  })

  it('renders compound icons as avatar by default', () => {
    const { container } = render(<MiniAppIcon app={{ ...baseApp, logo: 'compound-logo' }} size={48} />)

    const avatar = container.querySelector('[data-testid="compound-logo-avatar"]')
    expect(avatar).toBeInTheDocument()
    expect(avatar).toHaveClass('border', 'border-border')
    expect(avatar).not.toHaveClass('[&_[data-slot=avatar-fallback]]:bg-transparent')
  })

  it('centers plain bare-mark icons inside a bordered tile', () => {
    const { container } = render(
      <MiniAppIcon app={{ ...baseApp, logo: 'compound-logo' }} appearance="plain" size={48} />
    )

    expect(container.querySelector('[data-testid="compound-logo-avatar"]')).not.toBeInTheDocument()
    const tile = container.firstChild as HTMLElement
    expect(tile.tagName).toBe('SPAN')
    expect(tile).toHaveClass('border', 'border-border-subtle')
    expect(tile).toHaveStyle({ width: '48px', height: '48px' })
    const icon = container.querySelector('[data-testid="compound-logo"]')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveStyle({ width: '84%', height: '84%' })
  })

  it('renders plain full-bleed plates edge-to-edge in a borderless clipping tile', () => {
    const { container } = render(
      <MiniAppIcon app={{ ...baseApp, logo: 'full-bleed-logo' }} appearance="plain" size={40} />
    )

    expect(container.querySelector('[data-testid="compound-logo-avatar"]')).not.toBeInTheDocument()
    const tile = container.firstChild as HTMLElement
    expect(tile.tagName).toBe('SPAN')
    expect(tile).toHaveClass('overflow-hidden')
    expect(tile).not.toHaveClass('border')
    expect(tile).toHaveStyle({ width: '40px', height: '40px' })
    const icon = container.querySelector('[data-testid="compound-logo"]')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveStyle({ width: '108%', height: '108%' })
  })

  it('borders image logos only when the app is flagged bordered', () => {
    const uploadedApp = { ...baseApp, logoSrc: 'file:///files/abc123.webp' }
    const { container: bordered } = render(<MiniAppIcon app={{ ...uploadedApp, bordered: true }} />)
    expect(bordered.querySelector('img')).toHaveClass('border', 'border-border')

    const { container: borderless } = render(<MiniAppIcon app={uploadedApp} />)
    expect(borderless.querySelector('img')).not.toHaveClass('border')
  })

  it('renders bare icons directly without border chrome', () => {
    const { container } = render(
      <MiniAppIcon app={{ ...baseApp, logo: 'compound-logo' }} appearance="bare" size={16} />
    )

    const icon = container.querySelector('[data-testid="compound-logo"]')
    expect(icon).toBe(container.firstChild)
    expect(icon).not.toHaveClass('border')
    expect(icon).toHaveStyle({ width: '16px', height: '16px' })
  })
})
