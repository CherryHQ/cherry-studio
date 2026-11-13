import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import { CreateGroupDialog } from '../CreateGroupDialog'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'common.add': 'Add',
          'common.cancel': 'Cancel',
          'common.group.create': 'New Group',
          'common.group.create_failed': 'Failed to create group',
          'common.group.name_placeholder': 'Enter group name...',
          'common.group.name_required': 'Group name is required',
          'common.name': 'Name'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

describe('CreateGroupDialog', () => {
  afterEach(() => vi.restoreAllMocks())

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates an empty group name', () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)

    render(<CreateGroupDialog open onCreate={onCreate} onOpenChange={vi.fn()} />)

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))

    expect(onCreate).not.toHaveBeenCalled()
    expect(within(dialog).getByText('Group name is required')).toBeInTheDocument()
  })

  it('creates with a trimmed name and closes', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()

    render(<CreateGroupDialog open onCreate={onCreate} onOpenChange={onOpenChange} />)

    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '  Research  ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Research'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not create a group when Enter follows Escape during the exit animation', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    // Supply animation styles because JSDOM does not run the application's CSS.
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
    function Harness() {
      const [open, setOpen] = useState(true)
      return <CreateGroupDialog open={open} onCreate={onCreate} onOpenChange={setOpen} />
    }

    render(<Harness />)
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name'), 'Research')
    await user.keyboard('{Escape}')

    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('data-state', 'closed')
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Research')
    expect(within(dialog).getByLabelText('Name')).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('keeps the dialog open and shows the mutation error', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('name conflict'))
    const onOpenChange = vi.fn()

    render(<CreateGroupDialog open onCreate={onCreate} onOpenChange={onOpenChange} />)

    const dialog = screen.getByRole('dialog')
    const input = within(dialog).getByLabelText('Name')
    fireEvent.change(input, { target: { value: 'Research' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))

    expect(await within(dialog).findByText('Failed to create group: name conflict')).toBeInTheDocument()
    expect(input).toHaveValue('Research')
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
