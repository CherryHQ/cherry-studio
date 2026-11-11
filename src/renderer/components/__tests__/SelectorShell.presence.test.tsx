import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@cherrystudio/ui')

import { SelectorShell } from '../SelectorShell'

afterEach(() => vi.useRealTimers())

describe('SelectorShell close animation', () => {
  it('keeps a lazy-kept selector visible for its exit and preserves its input on reopening', async () => {
    const user = userEvent.setup()
    const view = (open: boolean) => (
      <SelectorShell
        trigger={<button type="button">Choose</button>}
        open={open}
        onOpenChange={vi.fn()}
        mountStrategy="lazy-keep">
        <input aria-label="Selector draft" />
      </SelectorShell>
    )
    const { rerender } = render(view(true))
    await user.type(screen.getByRole('textbox', { name: 'Selector draft' }), 'Keep this')
    const content = screen.getByRole('dialog')

    vi.useFakeTimers()
    rerender(view(false))
    expect(content).toHaveAttribute('data-state', 'closed')
    expect(content).toBeVisible()
    expect(content).toHaveAttribute('inert')

    await act(() => vi.advanceTimersByTime(119))
    expect(content).toBeVisible()
    await act(() => vi.advanceTimersByTime(1))
    expect(content).not.toBeVisible()

    rerender(view(true))
    expect(screen.getByRole('textbox', { name: 'Selector draft' })).toHaveValue('Keep this')
    expect(content).toBeVisible()
    expect(content).not.toHaveAttribute('inert')
  })

  it('does not hide a selector reopened before its old exit finishes', async () => {
    vi.useFakeTimers()
    const view = (open: boolean) => (
      <SelectorShell
        trigger={<button type="button">Choose</button>}
        open={open}
        onOpenChange={vi.fn()}
        mountStrategy="lazy-keep">
        <button type="button">An option</button>
      </SelectorShell>
    )
    const { rerender } = render(view(true))

    rerender(view(false))
    await act(() => vi.advanceTimersByTime(60))
    rerender(view(true))
    await act(() => vi.advanceTimersByTime(120))

    expect(screen.getByRole('button', { name: 'An option' })).toBeVisible()
    expect(screen.getByRole('dialog')).toHaveAttribute('data-state', 'open')
  })
})
