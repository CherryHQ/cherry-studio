import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateGroupDialog } from '../CreateGroupDialog'

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
