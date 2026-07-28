import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import EditNameDialog from '../EditNameDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'common.cancel': 'Cancel',
          'common.name': 'Name',
          'common.required_field': 'Required field',
          'common.save': 'Save'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

describe('EditNameDialog', () => {
  const onOpenChange = vi.fn()
  const onSubmit = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function renderDialog(initialName = 'Alpha') {
    render(
      <EditNameDialog
        open
        title="Edit name"
        initialName={initialName}
        onSubmit={onSubmit}
        onOpenChange={onOpenChange}
      />
    )
  }

  it('shows the initial name and autofocuses the input when opened', async () => {
    renderDialog()

    const dialog = screen.getByRole('dialog')
    const input = within(dialog).getByLabelText('Name')

    expect(input).toHaveValue('Alpha')
    await waitFor(() => expect(input).toHaveFocus())
  })

  it('does not submit an empty name', () => {
    renderDialog()

    const dialog = screen.getByRole('dialog')
    const input = within(dialog).getByLabelText('Name')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(within(dialog).getByText('Required field')).toBeInTheDocument()
  })

  it('closes without submitting when the trimmed name is unchanged', () => {
    renderDialog('Alpha')

    const dialog = screen.getByRole('dialog')
    const input = within(dialog).getByLabelText('Name')
    fireEvent.change(input, { target: { value: '  Alpha  ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('submits the trimmed name from Enter and the save button', async () => {
    const { rerender } = render(
      <EditNameDialog open title="Edit name" initialName="Alpha" onSubmit={onSubmit} onOpenChange={onOpenChange} />
    )

    const firstDialog = screen.getByRole('dialog')
    const firstInput = within(firstDialog).getByLabelText('Name')
    fireEvent.change(firstInput, { target: { value: '  Beta  ' } })
    fireEvent.keyDown(firstInput, { key: 'Enter' })

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Beta'))
    expect(onOpenChange).toHaveBeenCalledWith(false)

    vi.clearAllMocks()
    rerender(
      <EditNameDialog open title="Edit name" initialName="Alpha" onSubmit={onSubmit} onOpenChange={onOpenChange} />
    )

    const secondDialog = screen.getByRole('dialog')
    const secondInput = within(secondDialog).getByLabelText('Name')
    fireEvent.change(secondInput, { target: { value: '  Gamma  ' } })
    fireEvent.click(within(secondDialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Gamma'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
