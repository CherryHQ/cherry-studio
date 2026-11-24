import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ErrorState } from '../ErrorState'
import { LoadingState } from '../LoadingState'

type MockProps = Record<string, unknown> & {
  action?: ReactNode
  children?: ReactNode
  description?: ReactNode
  icon?: ReactNode
  message?: ReactNode
  type?: string
}

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')

  return {
    Alert: ({ action, children, description, icon, message, type, showIcon, ...props }: MockProps) => {
      void showIcon
      return React.createElement(
        'div',
        { ...props, role: type === 'error' ? 'alert' : 'status', 'data-testid': 'alert', 'data-type': type },
        icon,
        message ? React.createElement('span', null, message) : null,
        description ? React.createElement('span', null, description) : null,
        children,
        action
      )
    },
    Skeleton: ({ children, ...props }: MockProps) =>
      React.createElement('div', { ...props, 'data-slot': 'skeleton' }, children)
  }
})

describe('chat primitives', () => {
  it('renders loading states', () => {
    render(<LoadingState variant="skeleton" rows={2} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders error state content', () => {
    render(<ErrorState title="Error title" description="Error description" />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Error title')).toBeInTheDocument()
    expect(screen.getByText('Error description')).toBeInTheDocument()
  })
})
