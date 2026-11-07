import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { cloneElement, createContext, useContext } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

import type * as Ui from '@cherrystudio/ui'

import { AgentSessionNameControl } from '../AgentSessionNameControl'

const mocks = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof Ui>()
  const Context = createContext<{ open: boolean; change: (open: boolean) => void }>({ open: false, change: () => {} })
  return {
    ...actual,
    Popover: ({ open, onOpenChange, children }: any) => (
      <Context.Provider value={{ open, change: onOpenChange }}>{children}</Context.Provider>
    ),
    PopoverTrigger: ({ children }: any) => {
      const state = useContext(Context)
      return cloneElement(children, { onClick: () => state.change(!state.open) })
    },
    PopoverContent: ({ children }: any) => (useContext(Context).open ? <div>{children}</div> : null)
  }
})
vi.mock('@renderer/hooks/agent/useSession', () => ({ useUpdateSession: () => ({ updateSession: mocks.update }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
beforeEach(() => vi.clearAllMocks())

it('trims the edited name and targets the current session with the manual-name flag', async () => {
  const user = userEvent.setup()
  render(<AgentSessionNameControl sessionId="session-a" sessionName="Original" />)
  await user.click(screen.getByRole('button', { name: 'Original' }))
  const input = screen.getByRole('textbox')
  await user.clear(input)
  await user.type(input, '  Renamed  ')
  await user.click(screen.getByRole('button', { name: 'common.save' }))
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith(
    { id: 'session-a', name: 'Renamed', isNameManuallyEdited: true },
    { showSuccessToast: false }
  )
})

it('does not save a blank or unchanged name and refreshes the draft on reopening', async () => {
  const user = userEvent.setup()
  const view = render(<AgentSessionNameControl sessionId="session-a" sessionName="Original" />)
  await user.click(screen.getByRole('button', { name: 'Original' }))
  await user.click(screen.getByRole('button', { name: 'common.save' }))
  expect(mocks.update).not.toHaveBeenCalled()
  view.rerender(<AgentSessionNameControl sessionId="session-b" sessionName="Second" />)
  await user.click(screen.getByRole('button', { name: 'Second' }))
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('Second'))
  await user.clear(screen.getByRole('textbox'))
  expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled()
  fireEvent.submit(screen.getByRole('textbox').closest('form')!)
  expect(mocks.update).not.toHaveBeenCalled()
})

it('closes an unfinished rename when the active session changes', async () => {
  const user = userEvent.setup()
  const view = render(<AgentSessionNameControl sessionId="a" sessionName="First" />)
  await user.click(screen.getByRole('button', { name: 'First' }))
  await user.clear(screen.getByRole('textbox'))
  await user.type(screen.getByRole('textbox'), 'Unfinished A')
  view.rerender(<AgentSessionNameControl sessionId="b" sessionName="Second" />)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(mocks.update).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Second' }))
  expect(screen.getByRole('textbox')).toHaveValue('Second')
})
