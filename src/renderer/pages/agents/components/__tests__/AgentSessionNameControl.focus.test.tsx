import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, expect, it, vi } from 'vitest'

import { AgentSessionNameControl } from '../AgentSessionNameControl'

vi.mock('@cherrystudio/ui', async () => ({
  ...(await import('@cherrystudio/ui/components/primitives/popover')),
  ...(await import('@cherrystudio/ui/components/primitives/button')),
  ...(await import('@cherrystudio/ui/components/primitives/input'))
}))
vi.mock('@renderer/hooks/agent/useSession', () => ({ useUpdateSession: () => ({ updateSession: vi.fn() }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

it('keeps focus and typing in an outside search field when rename is dismissed', async () => {
  const user = userEvent.setup()
  const restore = vi.fn(() => screen.getByRole('textbox', { name: 'Composer' }).focus())
  render(
    <>
      <input aria-label="Session search" />
      <input aria-label="Composer" />
      <AgentSessionNameControl sessionId="a" sessionName="Original" onCloseAutoFocus={restore} />
    </>
  )
  await user.click(screen.getByRole('button', { name: 'Original' }))
  expect(screen.getByRole('textbox', { name: 'agent.session.edit.title' })).toHaveFocus()
  await user.click(screen.getByRole('textbox', { name: 'Session search' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.keyboard('search text')
  expect(screen.getByRole('textbox', { name: 'Session search' })).toHaveValue('search text')
  expect(screen.getByRole('textbox', { name: 'Composer' })).toHaveValue('')
  expect(restore).not.toHaveBeenCalled()
})

it('restores composer focus on Escape without an outside interaction', async () => {
  const user = userEvent.setup()
  const restore = vi.fn(() => screen.getByRole('textbox', { name: 'Composer' }).focus())
  render(
    <>
      <input aria-label="Composer" />
      <AgentSessionNameControl sessionId="a" sessionName="Original" onCloseAutoFocus={restore} />
    </>
  )
  await user.click(screen.getByRole('button', { name: 'Original' }))
  await user.keyboard('{Escape}')
  await waitFor(() => expect(restore).toHaveBeenCalledOnce())
  expect(screen.getByRole('textbox', { name: 'Composer' })).toHaveFocus()
})

it('labels the empty-name trigger and rename textbox', async () => {
  const user = userEvent.setup()
  render(<AgentSessionNameControl sessionId="a" sessionName="" />)
  await user.click(screen.getByRole('button', { name: 'message.tools.sessionCreate.untitled' }))
  expect(screen.getByRole('textbox', { name: 'agent.session.edit.title' })).toHaveValue('')
})
