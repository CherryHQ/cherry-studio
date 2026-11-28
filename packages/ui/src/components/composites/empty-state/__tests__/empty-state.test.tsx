// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { EmptyState } from '../index'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(() => {
  cleanup()
})

describe('EmptyState', () => {
  it('renders action button and fires callback', () => {
    const onAction = vi.fn()
    render(<EmptyState title="Empty" actionLabel="Create" onAction={onAction} />)
    const btn = screen.getByRole('button', { name: 'Create' })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('activates the action from the keyboard using the button accessible name', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(<EmptyState title="Empty" actionLabel="Create" onAction={onAction} />)

    const button = screen.getByRole('button', { name: 'Create' })
    button.focus()
    await user.keyboard('{Enter}')
    expect(onAction).toHaveBeenCalledTimes(1)

    await user.keyboard(' ')
    expect(onAction).toHaveBeenCalledTimes(2)
  })

  it('keeps the detail inside the empty state, right after the message', () => {
    render(<EmptyState title="Load failed" description="Try again" detail={<a href="#">Details</a>} />)
    const description = screen.getByText('Try again')
    const detail = screen.getByRole('link', { name: 'Details' })
    expect(description.parentElement).toContainElement(detail)
    expect(description.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders secondary button and fires callback', () => {
    const onSecondary = vi.fn()
    render(<EmptyState title="Empty" secondaryLabel="Learn more" onSecondary={onSecondary} />)
    const btn = screen.getByText('Learn more')
    fireEvent.click(btn)
    expect(onSecondary).toHaveBeenCalledTimes(1)
  })
})
