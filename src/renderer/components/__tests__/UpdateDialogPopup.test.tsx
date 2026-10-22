import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UpdateInfo } from 'builder-util-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PopupHost } from '@renderer/components/PopupHost'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())
vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: (...args: unknown[]) => mocks.request(...args) } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import UpdateDialogPopup from '../UpdateDialogPopup'

const releaseInfo = { version: '9.9.9', releaseNotes: 'Bug fixes' } as UpdateInfo

beforeEach(() => {
  vi.clearAllMocks()
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

describe('UpdateDialogPopup', () => {
  it('keeps a rejected install in the dialog and retries only when the user asks again', async () => {
    const user = userEvent.setup()
    mocks.request.mockRejectedValue(new Error('quitAndInstall rejected'))
    render(<PopupHost />)
    act(() => {
      void UpdateDialogPopup.show({ releaseInfo })
    })

    const install = await screen.findByRole('button', { name: 'update.install' })
    expect(mocks.request).not.toHaveBeenCalled()
    await user.click(install)

    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request).toHaveBeenCalledWith('app.updater.quit_and_install')
    expect(await screen.findByRole('alert')).toHaveTextContent('update.installFailed')
    expect(screen.queryByText('update.saveDataError')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mocks.request).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'update.install' }))
    expect(mocks.request).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('alert')).toHaveTextContent('update.installFailed')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
