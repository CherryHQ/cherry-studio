import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { LoadingState } from '../LoadingState'

type MockProps = Record<string, unknown> & {
  children?: ReactNode
}

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')

  return {
    Skeleton: ({ children, ...props }: MockProps) =>
      React.createElement('div', { ...props, 'data-slot': 'skeleton' }, children)
  }
})

describe('chat primitives', () => {
  it('renders loading states', () => {
    render(<LoadingState variant="skeleton" rows={2} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
