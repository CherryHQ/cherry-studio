import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import { SelectorShell } from '../SelectorShell'

// Use the real Radix popover: Escape routing depends on its dismissable layer stack.
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

function LazyKeptSelector({ name }: { name: string }) {
  const [open, setOpen] = useState(false)

  return (
    <SelectorShell
      trigger={<button type="button">{name}</button>}
      open={open}
      onOpenChange={setOpen}
      mountStrategy="lazy-keep">
      <div>{name} list</div>
    </SelectorShell>
  )
}

describe('SelectorShell interactions', () => {
  it('closes the open lazy-kept selector on Escape after another lazy-kept selector was opened and closed', async () => {
    const user = userEvent.setup()
    render(
      <>
        <LazyKeptSelector name="Model" />
        <LazyKeptSelector name="Workspace" />
      </>
    )
    const modelTrigger = screen.getByRole('button', { name: 'Model' })

    await user.click(modelTrigger)
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Workspace' }))
    await user.keyboard('{Escape}')
    await user.click(modelTrigger)
    expect(screen.getByRole('dialog')).toHaveTextContent('Model list')

    await user.keyboard('{Escape}')

    expect(modelTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
