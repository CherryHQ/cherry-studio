import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { ActionConfirmDialog } from '../ActionConfirmDialog'
import type { ResolvedActionConfirm } from '../actionTypes'

vi.unmock('@cherrystudio/ui')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function ConfirmationHarness() {
  const [confirm, setConfirm] = useState<ResolvedActionConfirm | undefined>({
    title: 'Delete message',
    description: 'This message will be removed.',
    cancelText: 'Keep message'
  })
  return (
    <ActionConfirmDialog
      confirm={confirm}
      open={confirm !== undefined}
      onConfirm={() => setConfirm(undefined)}
      onOpenChange={(open) => !open && setConfirm(undefined)}
    />
  )
}

it('retains the confirmation content during exit after its pending action is cleared', async () => {
  // JSDOM has no application CSS; provide the animation names Radix reads in the browser.
  const getComputedStyle = window.getComputedStyle
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const styles = getComputedStyle(element)
    return new Proxy(styles, {
      get(target, property, receiver) {
        if (property === 'animationName') return element.getAttribute('data-state') === 'closed' ? 'exit' : 'enter'
        if (property === 'display') return 'grid'
        return Reflect.get(target, property, receiver)
      }
    })
  })
  const user = userEvent.setup()
  render(<ConfirmationHarness />)
  const dialog = screen.getByRole('dialog', { name: 'Delete message' })

  await user.click(screen.getByRole('button', { name: 'Keep message' }))

  expect(dialog).toHaveAttribute('data-state', 'closed')
  expect(dialog).toHaveTextContent('This message will be removed.')
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
})
