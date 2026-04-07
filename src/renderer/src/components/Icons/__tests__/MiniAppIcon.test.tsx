import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import MiniAppIcon from '../MiniAppIcon'

vi.mock('@renderer/config/miniapps', () => ({
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
  getMiniAppsLogo: (logo: unknown) => logo
}))

describe('MiniAppIcon', () => {
  const mockApp = {
    appId: 'test-app-1',
    type: 'default' as const,
    status: 'enabled' as const,
    sortOrder: 0,
    name: 'Test App',
    url: 'https://test.com',
    logo: '/test-logo-1.png',
    bordered: true,
    background: '#f0f0f0',
    style: {
      opacity: 0.8,
      transform: 'scale(1.1)'
    }
  }

  it('should render correctly with various props', () => {
    const customStyle = { marginTop: '10px' }
    const { container } = render(<MiniAppIcon app={mockApp} size={64} style={customStyle} sidebar={false} />)

    expect(container.firstChild).toMatchSnapshot()
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
      appId: 'unknown-app',
      type: 'default' as const,
      status: 'enabled' as const,
      sortOrder: 0,
      name: 'Unknown App',
      url: 'https://unknown.com'
    }
    const { container } = render(<MiniAppIcon app={unknownApp} />)

    expect(container.firstChild).toBeNull()
  })
})
