import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import MinAppIcon from '../MinAppIcon'

vi.mock('@renderer/config/minapps', () => ({
  DEFAULT_MIN_APPS: [
    {
      id: 'test-app-1',
      name: 'Test App 1',
      logo: '/test-logo-1.png',
      url: 'https://test1.com',
      bodered: true,
      background: '#f0f0f0'
    },
    {
      id: 'test-app-2',
      name: 'Test App 2',
      logo: '/test-logo-2.png',
      url: 'https://test2.com',
      bodered: false,
      background: undefined
    }
  ]
}))

describe('MinAppIcon', () => {
  const mockApp = {
    id: 'test-app-1',
    name: 'Test App',
    url: 'https://test.com',
    style: {
      opacity: 0.8,
      transform: 'scale(1.1)'
    }
  }

  it('should render correctly with various props', () => {
    const customStyle = { marginTop: '10px' }
    const { container } = render(<MinAppIcon app={mockApp} size={64} style={customStyle} sidebar={false} />)

    expect(container.firstChild).toMatchSnapshot()
  })

  it('should not apply app.style when sidebar is true', () => {
    const { container } = render(<MinAppIcon app={mockApp} sidebar={true} />)
    const img = container.querySelector('img')

    expect(img).not.toHaveStyle({
      opacity: '0.8',
      transform: 'scale(1.1)'
    })
  })

  it('should return null when app is not found in DEFAULT_MIN_APPS', () => {
    const unknownApp = {
      id: 'unknown-app',
      name: 'Unknown App',
      url: 'https://unknown.com'
    }
    const { container } = render(<MinAppIcon app={unknownApp} />)

    expect(container.firstChild).toBeNull()
  })
})
