import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LoginOauthPanel from '../LoginOauthPanel'

const { requestMock, updateProviderMock, toastMock, modalMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  updateProviderMock: vi.fn().mockResolvedValue(undefined),
  toastMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  modalMock: { confirm: vi.fn() }
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: () => ({ updateProvider: updateProviderMock })
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => requestMock(...args) }
}))
vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}))

beforeEach(() => {
  vi.clearAllMocks()
  window.toast = toastMock as never
  window.modal = modalMock as never
})

describe('LoginOauthPanel', () => {
  it('mirrors the main-process enable into the renderer cache after sign-in', async () => {
    // has_token (initial refresh) → false, then oauth.sign_in resolves.
    requestMock.mockImplementation((channel: string) => {
      if (channel === 'oauth.has_token') return Promise.resolve(false)
      if (channel === 'oauth.sign_in') return Promise.resolve({ accountId: null })
      throw new Error(`unexpected channel: ${channel}`)
    })

    render(<LoginOauthPanel providerId="codex" i18nNs="codex" />)

    const signInButton = await screen.findByText('settings.provider.codex.sign_in_button')
    fireEvent.click(signInButton)

    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: true }))
    expect(requestMock).toHaveBeenCalledWith('oauth.sign_in', { providerId: 'codex' })
    expect(toastMock.success).toHaveBeenCalledWith('settings.provider.codex.sign_in_success')
  })

  it('resets auth to api-key and disables the provider in the cache on logout', async () => {
    requestMock.mockImplementation((channel: string) => {
      if (channel === 'oauth.has_token') return Promise.resolve(true)
      if (channel === 'oauth.get_account') return Promise.resolve({ accountId: 'acc-1' })
      if (channel === 'oauth.logout') return Promise.resolve(undefined)
      throw new Error(`unexpected channel: ${channel}`)
    })
    // Run the confirm dialog's onOk immediately.
    modalMock.confirm.mockImplementation(({ onOk }: { onOk: () => Promise<void> }) => onOk())

    render(<LoginOauthPanel providerId="codex" i18nNs="codex" showAccountId />)

    const logoutButton = await screen.findByText('settings.provider.oauth.logout')
    fireEvent.click(logoutButton)

    await waitFor(() =>
      expect(updateProviderMock).toHaveBeenCalledWith({ authConfig: { type: 'api-key' }, isEnabled: false })
    )
    expect(requestMock).toHaveBeenCalledWith('oauth.logout', { providerId: 'codex' })
  })
})
