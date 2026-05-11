import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { EmptyState } from '../EmptyState'
import { ErrorState } from '../ErrorState'
import { LoadingState } from '../LoadingState'
import { Panel } from '../Panel'
import { StatusBadge } from '../StatusBadge'
import { Toolbar } from '../Toolbar'

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
    Alert: ({ action, children, description, icon, message, type, showIcon: _showIcon, ...props }: MockProps) =>
      React.createElement(
        'div',
        { ...props, role: type === 'error' ? 'alert' : 'status', 'data-testid': 'alert', 'data-type': type },
        icon,
        message ? React.createElement('span', null, message) : null,
        description ? React.createElement('span', null, description) : null,
        children,
        action
      ),
    Badge: ({ children, ...props }: MockProps) =>
      React.createElement('span', { ...props, 'data-testid': 'badge' }, children),
    Skeleton: ({ children, ...props }: MockProps) =>
      React.createElement('div', { ...props, 'data-slot': 'skeleton' }, children)
  }
})

describe('chat primitives', () => {
  it('renders panel slots', () => {
    render(
      <Panel title="Panel title" description="Panel description" footer="Panel footer">
        Panel body
      </Panel>
    )

    expect(screen.getByText('Panel title')).toBeInTheDocument()
    expect(screen.getByText('Panel description')).toBeInTheDocument()
    expect(screen.getByText('Panel body')).toBeInTheDocument()
    expect(screen.getByText('Panel footer')).toBeInTheDocument()
  })

  it('renders empty state content and actions', () => {
    const Icon = ({ className }: { className?: string }) => <span className={className}>Icon</span>

    render(
      <EmptyState
        title="Empty title"
        description="Empty description"
        icon={Icon}
        actions={<button type="button">Action</button>}
      />
    )

    expect(screen.getByText('Icon')).toBeInTheDocument()
    expect(screen.getByText('Empty title')).toBeInTheDocument()
    expect(screen.getByText('Empty description')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument()
  })

  it('renders toolbar regions', () => {
    render(
      <Toolbar leading={<span>Leading</span>} trailing={<span>Trailing</span>}>
        <span>Main</span>
      </Toolbar>
    )

    expect(screen.getByRole('toolbar')).toBeInTheDocument()
    expect(screen.getByText('Leading')).toBeInTheDocument()
    expect(screen.getByText('Main')).toBeInTheDocument()
    expect(screen.getByText('Trailing')).toBeInTheDocument()
  })

  it('renders loading states', () => {
    const { container } = render(<LoadingState variant="skeleton" rows={2} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2)
  })

  it('renders error state content', () => {
    render(<ErrorState title="Error title" description="Error description" />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Error title')).toBeInTheDocument()
    expect(screen.getByText('Error description')).toBeInTheDocument()
  })

  it('renders status badge content', () => {
    render(<StatusBadge status="success">Ready</StatusBadge>)

    expect(screen.getByText('Ready')).toBeInTheDocument()
  })
})
