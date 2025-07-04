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

  it('should render with default props', () => {
    const { container } = render(<MinAppIcon app={mockApp} />)
    const img = container.querySelector('img')

    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', '/test-logo-1.png')
    expect(img).toHaveStyle({
      width: '48px',
      height: '48px',
      border: '0.5px solid var(--color-border)',
      backgroundColor: '#f0f0f0',
      opacity: '0.8',
      transform: 'scale(1.1)'
    })
  })

  it('should render with custom size', () => {
    const { container } = render(<MinAppIcon app={mockApp} size={64} />)
    const img = container.querySelector('img')

    expect(img).toHaveStyle({
      width: '64px',
      height: '64px'
    })
  })

  it('should not apply app.style when sidebar is true', () => {
    const { container } = render(<MinAppIcon app={mockApp} sidebar={true} />)
    const img = container.querySelector('img')

    expect(img).not.toHaveStyle({
      opacity: '0.8',
      transform: 'scale(1.1)'
    })
  })

  it('should apply custom style prop', () => {
    const customStyle = { marginTop: '10px', cursor: 'pointer' }
    const { container } = render(<MinAppIcon app={mockApp} style={customStyle} />)
    const img = container.querySelector('img')

    expect(img).toHaveStyle({
      marginTop: '10px',
      cursor: 'pointer'
    })
  })

  it('should render without border when bodered is false', () => {
    const appWithoutBorder = {
      id: 'test-app-2',
      name: 'Test App 2',
      url: 'https://test2.com'
    }
    const { container } = render(<MinAppIcon app={appWithoutBorder} />)
    const img = container.querySelector('img')

    expect(img).toHaveStyle({
      border: 'none'
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

  it('should match snapshot', () => {
    const { container } = render(<MinAppIcon app={mockApp} />)
    expect(container.firstChild).toMatchSnapshot()
  })
})
