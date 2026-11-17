// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { EmptyState } from '../empty-state'
import { EmptyStateScene, SceneButton, ScenePanel } from '../empty-state-scene'

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

  it('renders secondary button and fires callback', () => {
    const onSecondary = vi.fn()
    render(<EmptyState title="Empty" secondaryLabel="Learn more" onSecondary={onSecondary} />)
    const btn = screen.getByText('Learn more')
    fireEvent.click(btn)
    expect(onSecondary).toHaveBeenCalledTimes(1)
  })

  it('renders a scene in place of the illustration and keeps it out of the accessibility tree', () => {
    const onAction = vi.fn()
    const { container } = render(
      <EmptyState
        title="No files yet"
        actionLabel="Upload file"
        onAction={onAction}
        scene={
          <EmptyStateScene accent={2}>
            <ScenePanel>
              <SceneButton label="Upload" accent />
            </ScenePanel>
          </EmptyStateScene>
        }
      />
    )

    expect(container.querySelector('svg[viewBox="0 0 64 41"]')).toBeNull()
    const sceneText = screen.getByText('Upload')
    expect(sceneText.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(sceneText.closest('[inert]')).not.toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Upload file' }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: 'No files yet' })).toBeInTheDocument()
  })

  it('keeps the line illustration and icon override when no scene is given', () => {
    const { container, rerender } = render(<EmptyState title="Empty" illustration="book" />)
    expect(container.querySelector('svg[viewBox="0 0 64 41"]')).not.toBeNull()

    const Icon = ({ className }: { className?: string }) => <svg data-testid="override-icon" className={className} />
    rerender(<EmptyState title="Empty" icon={Icon} />)
    expect(screen.getByTestId('override-icon')).toBeInTheDocument()
    expect(container.querySelector('svg[viewBox="0 0 64 41"]')).toBeNull()
  })
})
