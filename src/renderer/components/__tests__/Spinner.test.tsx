import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import Spinner from '../Spinner'

// Mock motion/react to prevent animation issues in tests
vi.mock('motion/react', () => ({
  motion: {
    create: (Component: any) => {
      const MockedComponent = (props: any) => <Component {...props} />
      return MockedComponent
    }
  }
}))

describe('Spinner', () => {
  it('should render with text', () => {
    render(<Spinner text="Searching..." />)
    expect(screen.getByText('Searching...')).toBeInTheDocument()
  })

  it('should render search icon', () => {
    const { container } = render(<Spinner text="Loading..." />)
    const icon = container.querySelector('svg')
    expect(icon).toBeInTheDocument()
  })

  it('should render with empty text', () => {
    const { container } = render(<Spinner text="" />)
    const spanElement = container.querySelector('span')
    expect(spanElement).toBeInTheDocument()
    expect(spanElement).toHaveTextContent('')
  })

  it('should match snapshot', () => {
    const { container } = render(<Spinner text="Loading files..." />)
    expect(container.firstChild).toMatchSnapshot()
  })
})
