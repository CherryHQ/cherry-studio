import { MockUseDataApiUtils, mockUseInvalidateCache } from '@test-mocks/renderer/useDataApi'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { oauthErrorCodes } from '@shared/ipc/errors/oauth'

import LoginOauthPanel from '../LoginOauthPanel'

const { requestMock, tMock, invalidateProviderCacheMock, providerPatchMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  tMock: (key: string) => key,
  invalidateProviderCacheMock: vi.fn().mockResolvedValue(undefined),
  providerPatchMock: vi.fn().mockResolvedValue(undefined)
}))

const PROVIDER_CACHE_PATHS = ['/providers', '/providers/codex', '/providers/codex/*']

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tMock })
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
  MockUseDataApiUtils.resetMocks()
  mockUseInvalidateCache.mockReturnValue(invalidateProviderCacheMock)
  MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/providers/:providerId', providerPatchMock)
})

describe('LoginOauthPanel', () => {
  it('invalidates provider DataApi reads after sign-in', async () => {
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

    await waitFor(() => expect(invalidateProviderCacheMock).toHaveBeenCalledWith(PROVIDER_CACHE_PATHS))
    expect(providerPatchMock).not.toHaveBeenCalled()
    expect(requestMock).toHaveBeenCalledWith('oauth.sign_in', {
      providerId: 'codex',
      requestId: expect.any(String)
    })
    expect(toast.success).toHaveBeenCalledWith('settings.provider.codex.sign_in_success')
  })

  it('invalidates provider DataApi reads when sign-in completes after unmount', async () => {
    let resolveSignIn: (account: { accountId: string | null }) => void = () => {}
    requestMock.mockImplementation((channel: string) => {
      if (channel === 'oauth.has_token') return Promise.resolve(false)
      if (channel === 'oauth.sign_in.attach') return Promise.resolve({ status: 'not-found' })
      if (channel === 'oauth.sign_in') {
        return new Promise((resolve) => {
          resolveSignIn = resolve
        })
      }
      throw new Error(`unexpected channel: ${channel}`)
    })
    const user = userEvent.setup()

    const { unmount } = render(<LoginOauthPanel providerId="codex" i18nNs="codex" />)
    await user.click(await screen.findByRole('button', { name: 'settings.provider.codex.sign_in_button' }))
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith('oauth.sign_in', {
        providerId: 'codex',
        requestId: expect.any(String)
      })
    )

    unmount()
    resolveSignIn({ accountId: null })

    await waitFor(() => expect(invalidateProviderCacheMock).toHaveBeenCalledWith(PROVIDER_CACHE_PATHS))
    expect(providerPatchMock).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('invalidates provider DataApi reads after logout', async () => {
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

    await waitFor(() => expect(invalidateProviderCacheMock).toHaveBeenCalledWith(PROVIDER_CACHE_PATHS))
    expect(providerPatchMock).not.toHaveBeenCalled()
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
    expect(requestMock).toHaveBeenCalledWith('oauth.sign_in.attach', {
      providerId: 'codex',
      requestId: expect.any(String)
    })
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
    expect(invalidateProviderCacheMock).toHaveBeenCalledWith(PROVIDER_CACHE_PATHS)
    expect(providerPatchMock).not.toHaveBeenCalled()
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
    const signInInput = requestMock.mock.calls.find(([channel]) => channel === 'oauth.sign_in')?.[1]
    expect(signInInput).toEqual({ providerId: 'codex', requestId: expect.any(String) })
    expect(requestMock).toHaveBeenCalledWith('oauth.cancel_sign_in', {
      providerId: 'codex',
      requestId: signInInput.requestId
    })

    await user.click(retryButton)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('settings.provider.codex.sign_in_success'))
    expect(signInAttempt).toBe(2)
  })
})
