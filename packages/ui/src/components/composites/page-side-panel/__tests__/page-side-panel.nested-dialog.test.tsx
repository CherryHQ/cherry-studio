// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../../../primitives/dialog'
import { PageSidePanel } from '../index'

// A portaled child dialog's Escape must not discard the underlying side panel's form.
it('dismisses only the child dialog on Escape and leaves the side panel usable', async () => {
  const onClose = vi.fn()
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <PageSidePanel open title="Settings" onClose={onClose}>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button type="button">Pick model</button>
          </DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Models</DialogTitle>
            <input aria-label="Search models" />
          </DialogContent>
        </Dialog>
      </PageSidePanel>
    )
  }
  const user = userEvent.setup()
  render(<Harness />)
  await user.click(screen.getByRole('button', { name: 'Pick model' }))
  await user.type(screen.getByRole('textbox', { name: 'Search models' }), 'Gemini')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Models' })).not.toBeInTheDocument())
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  expect(onClose).not.toHaveBeenCalled()
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledOnce()
})
