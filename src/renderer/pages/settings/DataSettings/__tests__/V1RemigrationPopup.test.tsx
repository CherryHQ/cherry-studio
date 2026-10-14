import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PopupHost } from '@renderer/components/PopupHost'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'

const mocks = vi.hoisted(() => ({
  backupShow: vi.fn(),
  request: vi.fn()
}))

vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())
vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal())

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request }
}))

vi.mock('../BackupPopup', () => ({
  default: { show: mocks.backupShow }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { seconds?: number }) =>
      options?.seconds === undefined ? key : `${key}:${options.seconds}`
  })
}))

import V1RemigrationPopup from '../V1RemigrationPopup'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.backupShow.mockResolvedValue(undefined)
  mocks.request.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.useFakeTimers()
  for (const entry of [...popupService.getSnapshot()]) {
    popupService.settle(entry.instanceId, undefined)
  }
  vi.advanceTimersByTime(POPUP_EXIT_MS)
  vi.useRealTimers()
})

describe('V1RemigrationPopup', () => {
  it('gates the three-step wizard, offers a forced full backup, and requests remigration only at the end', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)
    act(() => {
      void V1RemigrationPopup.show()
    })

    expect(await screen.findByLabelText('settings.data.v1_remigration.final_message')).toBeInTheDocument()
    expect(screen.queryByText('settings.data.v1_remigration.step_label')).not.toBeInTheDocument()
    const next = screen.getByRole('button', { name: 'settings.data.v1_remigration.next' })
    expect(next).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'settings.data.v1_remigration.confirm' })).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('settings.data.v1_remigration.final_message'))
    expect(next).toBeDisabled()
    await user.click(screen.getByLabelText('settings.data.v1_remigration.final_retained'))
    expect(next).toBeDisabled()
    await user.click(screen.getByLabelText('settings.data.v1_remigration.acknowledgement'))
    expect(next).toBeEnabled()
    await user.click(next)

    expect(screen.getByText('settings.data.v1_remigration.backup_message')).toBeInTheDocument()
    const backupNext = screen.getByRole('button', { name: 'settings.data.v1_remigration.next' })
    expect(backupNext).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'settings.data.v1_remigration.backup_button' }))
    expect(mocks.backupShow).toHaveBeenCalledExactlyOnceWith({ forceFullBackup: true })
    expect(mocks.request).not.toHaveBeenCalled()
    expect(backupNext).toBeDisabled()

    await user.click(screen.getByLabelText('settings.data.v1_remigration.backup_acknowledgement'))
    expect(backupNext).toBeEnabled()
    vi.useFakeTimers()
    act(() => backupNext.click())

    expect(screen.getByText('settings.data.v1_remigration.final_confirmation')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: 'settings.data.v1_remigration.confirm_countdown:5' })
    expect(confirm).toBeDisabled()
    await act(() => vi.advanceTimersByTime(4000))
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveTextContent('settings.data.v1_remigration.confirm_countdown:1')
    confirm.click()
    expect(mocks.request).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTime(1000))
    expect(confirm).toBeEnabled()
    expect(confirm).toHaveTextContent('settings.data.v1_remigration.confirm')
    await act(async () => {
      confirm.click()
      await Promise.resolve()
    })
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith('app.migration_v2.rerun')
    expect(confirm).toBeDisabled()
  })

  it('accepts an existing backup and keeps the final step open when the request fails', async () => {
    const user = userEvent.setup()
    mocks.request.mockRejectedValueOnce(new Error('marker write failed'))
    render(<PopupHost />)
    act(() => {
      void V1RemigrationPopup.show()
    })

    await user.click(await screen.findByLabelText('settings.data.v1_remigration.final_message'))
    await user.click(screen.getByLabelText('settings.data.v1_remigration.final_retained'))
    await user.click(screen.getByLabelText('settings.data.v1_remigration.acknowledgement'))
    await user.click(screen.getByRole('button', { name: 'settings.data.v1_remigration.next' }))
    await user.click(screen.getByLabelText('settings.data.v1_remigration.backup_acknowledgement'))
    const backupNext = screen.getByRole('button', { name: 'settings.data.v1_remigration.next' })
    vi.useFakeTimers()
    act(() => backupNext.click())

    expect(mocks.backupShow).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTime(5000))
    const confirm = screen.getByRole('button', { name: 'settings.data.v1_remigration.confirm' })
    await act(async () => {
      confirm.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('settings.data.v1_remigration.error')
    expect(confirm).toBeEnabled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('settings.data.v1_remigration.final_confirmation')).toBeInTheDocument()
  })
})
