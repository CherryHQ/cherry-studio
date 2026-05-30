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

  it('renders with preset icon', () => {
    const { container } = render(<EmptyState preset="no-code-tool" title="No tools" />)
    // Should render an SVG icon from the preset
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByText('No tools')).toBeInTheDocument()
  })

  it('applies compact styling', () => {
    const { container } = render(<EmptyState compact title="Compact" />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toContain('py-8')
  })

  it('applies custom className', () => {
    const { container } = render(<EmptyState className="custom-class" title="Test" />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toContain('custom-class')
  })
})
