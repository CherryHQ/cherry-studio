// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { EmptyState } from '../index'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
})

afterEach(() => {
  cleanup()
})

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState title="No items" description="Add something" />)
    expect(screen.getByText('No items')).toBeInTheDocument()
    expect(screen.getByText('Add something')).toBeInTheDocument()
  })

  it('renders action button and fires callback', () => {
    const onAction = vi.fn()
    render(<EmptyState title="Empty" actionLabel="Create" onAction={onAction} />)
    const btn = screen.getByText('Create')
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('renders secondary button and fires callback', () => {
    const onSecondary = vi.fn()
    render(<EmptyState title="Empty" secondaryLabel="Learn more" onSecondary={onSecondary} />)
    const btn = screen.getByText('Learn more')
    fireEvent.click(btn)
    expect(onSecondary).toHaveBeenCalledTimes(1)
  })

  it('does not render buttons when no labels provided', () => {
    const { container } = render(<EmptyState title="Empty" />)
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('renders the unified illustration for presets', () => {
    const { container } = render(<EmptyState preset="no-code-tool" title="No tools" />)

    expect(container.querySelector('svg[viewBox="0 0 64 41"]')).toBeInTheDocument()
    expect(screen.getByText('No tools')).toBeInTheDocument()
  })

  it('applies compact styling', () => {
    const { container } = render(<EmptyState compact title="Compact" />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toContain('py-8')
  })

  it('renders the inbox illustration by default', () => {
    const { container } = render(<EmptyState title="Empty" />)
    expect(container.querySelector('svg')).toBeInTheDocument()
    // the sparkle path is unique to the book variant
    expect(container.querySelector('path[fill-opacity="0.35"]')).not.toBeInTheDocument()
  })

  it('renders the book illustration variant', () => {
    const { container } = render(<EmptyState illustration="book" title="Empty" />)
    expect(container.querySelector('path[fill-opacity="0.35"]')).toBeInTheDocument()
  })

  it('prefers an explicit icon over the illustration', () => {
    const Icon = ({ className }: { className?: string }) => (
      <svg data-testid="custom-icon" className={className} aria-hidden="true" />
    )
    const { container } = render(<EmptyState icon={Icon} title="Empty" />)
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
    expect(container.querySelectorAll('svg')).toHaveLength(1)
  })

  it('keeps spacing between the title and actions when no description is present', () => {
    render(<EmptyState title="Empty" actionLabel="Create" onAction={vi.fn()} />)
    expect(screen.getByText('Empty').className).toContain('mb-5')
  })

  it('applies custom className', () => {
    const { container } = render(<EmptyState className="custom-class" title="Test" />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toContain('custom-class')
  })
})
