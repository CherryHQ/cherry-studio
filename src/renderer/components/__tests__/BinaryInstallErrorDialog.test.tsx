import { toast } from '@renderer/services/toast'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BinaryInstallErrorDialog } from '../BinaryInstallErrorDialog'

// t returns the key so we can assert on stable identifiers instead of copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const mockWriteText = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(navigator, { clipboard: { writeText: mockWriteText } })
})

const renderDialog = (action: 'install' | 'remove' = 'install') =>
  render(<BinaryInstallErrorDialog error={{ name: 'fd', message: 'mise failed', action }} onOpenChange={vi.fn()} />)

describe('BinaryInstallErrorDialog copy', () => {
  it('uses removal copy for a failed remove', () => {
    renderDialog('remove')

    expect(screen.getByText('settings.dependencies.removeError: fd')).toBeInTheDocument()
    expect(screen.getByText('settings.dependencies.removeErrorHint')).toBeInTheDocument()
    expect(screen.queryByText('settings.dependencies.installErrorHint')).not.toBeInTheDocument()
  })

  it('copies the error message to the clipboard', async () => {
    mockWriteText.mockResolvedValue(undefined)
    renderDialog()

    await userEvent.click(screen.getByRole('button', { name: 'common.copy' }))

    expect(mockWriteText).toHaveBeenCalledWith('mise failed')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('surfaces the copy-failed toast when the clipboard write is rejected', async () => {
    // A denied clipboard permission must not leave an unhandled rejection.
    mockWriteText.mockRejectedValue(new Error('clipboard denied'))
    renderDialog()

    await userEvent.click(screen.getByRole('button', { name: 'common.copy' }))

    expect(toast.error).toHaveBeenCalledWith('common.copy_failed')
  })
})
