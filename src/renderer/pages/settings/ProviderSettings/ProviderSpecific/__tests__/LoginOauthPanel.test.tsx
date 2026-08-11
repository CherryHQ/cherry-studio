import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { oauthErrorCodes } from '@shared/ipc/errors/oauth'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LoginOauthPanel from '../LoginOauthPanel'

const { requestMock, tMock, updateProviderMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  tMock: (key: string) => key,
  updateProviderMock: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tMock })
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
})

describe('LoginOauthPanel', () => {
  it('mirrors the main-process enable into the renderer cache after sign-in', async () => {
    requestMock.mockImplementation((channel: string) => {
      if (channel === 'oauth.has_token') return Promise.resolve(false)
      if (channel === 'oauth.sign_in.attach') return Promise.resolve({ status: 'not-found' })
      if (channel === 'oauth.sign_in') return Promise.resolve({ accountId: null })
      throw new Error(`unexpected channel: ${channel}`)
    })
    const user = userEvent.setup()

    render(<LoginOauthPanel providerId="codex" i18nNs="codex" />)

    const signInButton = await screen.findByText('settings.provider.codex.sign_in_button')
    await user.click(signInButton)

    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: true }))
    expect(requestMock).toHaveBeenCalledWith('oauth.sign_in', { providerId: 'codex' })
    expect(toast.success).toHaveBeenCalledWith('settings.provider.codex.sign_in_success')
  })

  it('resets auth to api-key and disables the provider in the cache on logout', async () => {
    requestMock.mockImplementation((channel: string) => {
      if (channel === 'oauth.has_token') return Promise.resolve(true)
      if (channel === 'oauth.get_account') return Promise.resolve({ accountId: 'acc-1' })
      if (channel === 'oauth.logout') return Promise.resolve(undefined)
      throw new Error(`unexpected channel: ${channel}`)
    })
    const user = userEvent.setup()
    // The global popup.confirm mock invokes onOk and resolves true (the confirmed path).

    render(<LoginOauthPanel providerId="codex" i18nNs="codex" showAccountId />)

    const logoutButton = await screen.findByText('settings.provider.oauth.logout')
    await user.click(logoutButton)

    await waitFor(() =>
      expect(updateProviderMock).toHaveBeenCalledWith({ authConfig: { type: 'api-key' }, isEnabled: false })
    )
    expect(popup.confirm).toHaveBeenCalled()
    expect(requestMock).toHaveBeenCalledWith('oauth.logout', { providerId: 'codex' })
  })

  it('restores the waiting state by attaching to an active main-process sign-in', async () => {
    requestMock.mockImplementation((channel: string) => {
      if (channel === 'oauth.has_token') return Promise.resolve(false)
      if (channel === 'oauth.sign_in.attach') return new Promise(() => {})
      if (channel === 'oauth.sign_in') throw new Error('mount must not start sign-in')
      throw new Error(`unexpected channel: ${channel}`)
    })

    render(<LoginOauthPanel providerId="codex" i18nNs="codex" />)

    expect(await screen.findByText('settings.provider.codex.signing_in')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeEnabled()
    expect(requestMock).toHaveBeenCalledWith('oauth.sign_in.attach', { providerId: 'codex' })
    expect(requestMock).not.toHaveBeenCalledWith('oauth.sign_in', expect.anything())
  })

  it('recovers completion between the first token read and attach without starting a new flow', async () => {
    let tokenRead = 0
    requestMock.mockImplementation((channel: string) => {
      if (channel === 'oauth.has_token') {
        tokenRead += 1
        return Promise.resolve(tokenRead === 2)
      }
      if (channel === 'oauth.sign_in.attach') return Promise.resolve({ status: 'not-found' })
      if (channel === 'oauth.get_account') return Promise.resolve({ accountId: 'acc-1' })
      if (channel === 'oauth.sign_in') throw new Error('recovery must not start sign-in')
      throw new Error(`unexpected channel: ${channel}`)
    })

    render(<LoginOauthPanel providerId="codex" i18nNs="codex" showAccountId />)

    expect(await screen.findByText('settings.provider.codex.logged_in')).toBeInTheDocument()
    expect(requestMock).toHaveBeenCalledTimes(4)
    expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: true })
    expect(requestMock).not.toHaveBeenCalledWith('oauth.sign_in', expect.anything())
  })

  it('recovers cancellation between the first token read and attach without a failure toast', async () => {
    requestMock.mockImplementation((channel: string) => {
      if (channel === 'oauth.has_token') return Promise.resolve(false)
      if (channel === 'oauth.sign_in.attach') return Promise.resolve({ status: 'not-found' })
      if (channel === 'oauth.sign_in') throw new Error('recovery must not start sign-in')
      throw new Error(`unexpected channel: ${channel}`)
    })

    render(<LoginOauthPanel providerId="codex" i18nNs="codex" />)

    expect(await screen.findByRole('button', { name: 'settings.provider.codex.sign_in_button' })).toBeEnabled()
    expect(requestMock).toHaveBeenCalledTimes(3)
    expect(toast.error).not.toHaveBeenCalled()
    expect(requestMock).not.toHaveBeenCalledWith('oauth.sign_in', expect.anything())
  })

  it('cancels without a failure toast and permits an immediate retry', async () => {
    let rejectSignIn: (error: unknown) => void = () => {}
    let signInAttempt = 0
    requestMock.mockImplementation((channel: string) => {
      if (channel === 'oauth.has_token') return Promise.resolve(false)
      if (channel === 'oauth.sign_in.attach') return Promise.resolve({ status: 'not-found' })
      if (channel === 'oauth.sign_in') {
        signInAttempt += 1
        if (signInAttempt === 1) {
          return new Promise((_resolve, reject) => {
            rejectSignIn = reject
          })
        }
        return Promise.resolve({ accountId: null })
      }
      if (channel === 'oauth.cancel_sign_in') {
        rejectSignIn(new IpcError(oauthErrorCodes.SIGN_IN_CANCELLED))
        return Promise.resolve(undefined)
      }
      throw new Error(`unexpected channel: ${channel}`)
    })
    const user = userEvent.setup()

    render(<LoginOauthPanel providerId="codex" i18nNs="codex" />)

    await user.click(await screen.findByRole('button', { name: 'settings.provider.codex.sign_in_button' }))
    await user.click(await screen.findByRole('button', { name: 'common.cancel' }))

    const retryButton = await screen.findByRole('button', { name: 'settings.provider.codex.sign_in_button' })
    expect(toast.error).not.toHaveBeenCalled()
    expect(requestMock).toHaveBeenCalledWith('oauth.cancel_sign_in', { providerId: 'codex' })

    await user.click(retryButton)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('settings.provider.codex.sign_in_success'))
    expect(signInAttempt).toBe(2)
  })
})
