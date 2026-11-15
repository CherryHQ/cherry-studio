import { render } from '@testing-library/react'
import type React from 'react'
import { describe, expect, it, vi } from 'vitest'

import MiniAppIcon from '../MiniAppIcon'
import type * as MiniAppsLogoModule from '../miniAppsLogo'

// Mirror production: only preset keys resolve to a CompoundIcon; everything else
// (an uploaded logo's `file://` URL) returns undefined and renders as an image.
vi.mock('@renderer/components/icons/miniAppsLogo', async (importOriginal) => {
  const actual = await importOriginal<typeof MiniAppsLogoModule>()
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
  return {
    getMiniAppsLogoRef: (logo: unknown) =>
      logo === 'compound-logo' || logo === 'felo' || logo === 'abacus' || logo === 'ling' || logo === 'loading-logo'
        ? { kind: 'provider', key: logo, meta: { id: logo, colorPrimary: '#000000' } }
        : actual.getMiniAppsLogoRef(logo as string | undefined),
    useMiniAppLogo: (logo: unknown) => (logo !== 'loading-logo' ? CompoundLogo : undefined)
  }
})

describe('MiniAppIcon', () => {
  it.each(['minimax', 'zeroone', 'mintop3', '3mintop', 'claude', 'ling'])(
    'keeps the aliased %s artwork inside the sidebar glyph target',
    (logo) => {
      const { getByLabelText } = render(
        <MiniAppIcon app={{ logo, name: 'Mini App' }} appearance="bare" size={18} artworkSize={14} />
      )
      expect(getByLabelText('Mini App')).toHaveStyle({ width: '14px', height: '14px' })
    }
  )
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

  it('renders an uploaded sidebar logo as a transparent circular icon', () => {
    const { container } = render(
      <MiniAppIcon
        app={{ ...baseApp, logoSrc: 'file:///files/installed.webp', background: '#ffffff' }}
        appearance="sidebar"
        size={24}
      />
    )

    const image = container.querySelector('img') as HTMLImageElement
    expect(container.firstElementChild).not.toHaveClass('bg-white/90')
    expect(image).toHaveClass('rounded-full', 'object-cover')
    expect(image).toHaveStyle({ width: '24px', height: '24px' })
    expect(image.style.backgroundColor).toBe('')
  })
})
