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
vi.stubGlobal('__APP_RELEASE_VERSION__', '2.0.0')

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US', resolvedLanguage: 'en-US' } })
}))

import UpdateDialogPopup from '../UpdateDialogPopup'

const releaseInfo = { version: '9.9.9', releaseNotes: 'Bug fixes' } as UpdateInfo

const installCalls = () => mocks.request.mock.calls.filter(([route]) => route === 'app.updater.quit_and_install')

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
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'app.updater.quit_and_install') throw new Error('quitAndInstall rejected')
      return { fromVersion: '2.0.0', toVersion: '9.9.9', historyStatus: 'unavailable', releases: [] }
    })
    render(<PopupHost />)
    act(() => {
      void UpdateDialogPopup.show({ releaseInfo })
    })

    const install = await screen.findByRole('button', { name: 'update.install' })
    expect(installCalls()).toHaveLength(0)
    await user.click(install)

    expect(installCalls()).toHaveLength(1)
    expect(await screen.findByRole('alert')).toHaveTextContent('update.installFailed')
    expect(screen.queryByText('update.saveDataError')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(installCalls()).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'update.install' }))
    expect(installCalls()).toHaveLength(2)
    expect(screen.getByRole('alert')).toHaveTextContent('update.installFailed')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
