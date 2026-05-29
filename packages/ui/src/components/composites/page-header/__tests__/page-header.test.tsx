// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { PageHeader } from '../index'

afterEach(() => {
  cleanup()
})

describe('PageHeader', () => {
  it('renders title inside an h2', () => {
    render(<PageHeader title="Settings" />)
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading).toHaveTextContent('Settings')
  })

  it('renders action slot to the right of the title', () => {
    render(<PageHeader title="Model Service" action={<button type="button">Filter</button>} />)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Model Service')
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument()
  })

  it('applies truncate class on the title for overflow safety', () => {
    render(<PageHeader title="A very long title that should be truncated when the container shrinks" />)
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.className).toMatch(/\btruncate\b/)
  })

  it('forwards extra props like data-testid and merges className', () => {
    render(<PageHeader title="X" data-testid="page-header" className="custom-extra" />)
    const node = screen.getByTestId('page-header')
    expect(node).toHaveAttribute('data-slot', 'page-header')
    expect(node.className).toMatch(/\bcustom-extra\b/)
  })

  it('merges titleClassName onto the h2 so consumers can override label typography (e.g. for section-title-style page headers)', () => {
    render(<PageHeader title="Models" titleClassName="text-xs text-foreground-muted font-normal" />)
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.className).toMatch(/\btext-xs\b/)
    expect(heading.className).toMatch(/\btext-foreground-muted\b/)
    expect(heading.className).toMatch(/\bfont-normal\b/)
  })
})
