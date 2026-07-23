import { toast } from '@renderer/services/toast'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BinaryInstallErrorDialog } from '../BinaryInstallErrorDialog'

// t returns the key so we can assert on stable identifiers instead of copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const mockWriteText = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mockWriteText } })
})

afterEach(() => {
  vi.useRealTimers()
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

  it('ignores a stale copy completion after a different error opens', async () => {
    vi.useFakeTimers()
    let resolveWrite!: () => void
    mockWriteText.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveWrite = resolve
      })
    )
    const { rerender } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'common.copy' }))
    rerender(
      <BinaryInstallErrorDialog
        error={{ name: 'rg', message: 'another mise failure', action: 'remove' }}
        onOpenChange={vi.fn()}
      />
    )
    await act(async () => resolveWrite())

    expect(screen.getByRole('button', { name: 'common.copy' })).toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('resets copied state after close before reopening', async () => {
    mockWriteText.mockResolvedValue(undefined)
    const { rerender } = renderDialog()

    await userEvent.click(screen.getByRole('button', { name: 'common.copy' }))
    expect(screen.getByRole('button', { name: 'common.copied' })).toBeInTheDocument()

    rerender(<BinaryInstallErrorDialog error={null} onOpenChange={vi.fn()} />)
    rerender(
      <BinaryInstallErrorDialog
        error={{ name: 'fd', message: 'mise failed again', action: 'install' }}
        onOpenChange={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'common.copy' })).toBeInTheDocument()
  })

  it('restarts the copied reset timer on repeated copies and clears it on unmount', async () => {
    vi.useFakeTimers()
    mockWriteText.mockResolvedValue(undefined)
    const { unmount } = renderDialog()

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'common.copy' })))
    await act(() => vi.advanceTimersByTimeAsync(1000))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'common.copied' })))
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(screen.getByRole('button', { name: 'common.copied' })).toBeInTheDocument()

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
