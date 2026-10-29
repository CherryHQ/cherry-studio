import { act, renderHook, waitFor } from '@testing-library/react'
import { createInstance } from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import enUs from '@renderer/i18n/locales/en-us.json'

const i18n = createInstance()
await i18n.init({
  resources: { en: { translation: enUs } },
  lng: 'en',
  keySeparator: false,
  interpolation: { escapeValue: false }
})

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  statusChanged: undefined as ((status: { phase: string; displayName: string | null }) => void) | undefined,
  toastError: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest },
  useIpcOn: (_event: string, listener: NonNullable<typeof mocks.statusChanged>) => {
    mocks.statusChanged = listener
  }
}))

vi.mock('@renderer/services/toast', () => ({ toast: { error: mocks.toastError } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: i18n.t }) }))

import { cherryCloudErrorCodes } from '@shared/ipc/errors/cherryCloud'
import { IpcError } from '@shared/ipc/errors/IpcError'

import { useCherryAccountSession } from '../useCherryAccountSession'

const signedOut = { phase: 'signed-out' as const, displayName: null }
const signedIn = { phase: 'signed-in' as const, displayName: 'Sora' }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useCherryAccountSession', () => {
  beforeEach(() => {
    mocks.ipcRequest.mockReset().mockResolvedValue(signedOut)
    mocks.statusChanged = undefined
    mocks.toastError.mockReset()
  })

  it('does not let an older status request overwrite a newer status event', async () => {
    const pendingStatus = deferred<typeof signedOut>()
    mocks.ipcRequest.mockReturnValueOnce(pendingStatus.promise)
    const { result } = renderHook(() => useCherryAccountSession())

    act(() => mocks.statusChanged?.(signedIn))
    expect(result.current.status).toEqual(signedIn)

    await act(async () => {
      pendingStatus.resolve(signedOut)
      await pendingStatus.promise
    })
    expect(result.current.status).toEqual(signedIn)
  })

  it.each([
    [
      'login',
      'cherry_cloud.login.start',
      'isStartingLogin',
      { phase: 'authorizing', accountId: null, displayName: null }
    ],
    ['cancelLogin', 'cherry_cloud.login.cancel', 'isCancellingLogin', signedOut],
    ['revokeSession', 'cherry_cloud.session.revoke', 'isRevokingSession', signedOut]
  ] as const)('runs %s with an isolated loading state', async (action, route, pendingFlag, nextStatus) => {
    const pendingAction = deferred<typeof nextStatus>()
    const { result } = renderHook(() => useCherryAccountSession())
    await waitFor(() => expect(result.current.loadState).toBe('ready'))
    mocks.ipcRequest.mockImplementationOnce((requestedRoute: string) => {
      expect(requestedRoute).toBe(route)
      return pendingAction.promise
    })

    let request!: Promise<void>
    act(() => {
      request = result.current[action]()
    })
    expect(result.current[pendingFlag]).toBe(true)

    await act(async () => {
      pendingAction.resolve(nextStatus)
      await request
    })
    expect(result.current.status).toEqual(nextStatus)
    expect(result.current[pendingFlag]).toBe(false)
  })

  it.each([
    ['login', new IpcError(cherryCloudErrorCodes.LOGIN_SERVICE_UNAVAILABLE), enUs['error.http.503']],
    ['login', new IpcError('CHERRY_CLOUD_UPGRADE_REQUIRED'), enUs['settings.provider.cherry_cloud.upgrade_required']],
    [
      'login',
      new Error('Cherry Cloud login request failed (400)'),
      { title: 'Cherry Cloud sign-in failed', description: 'An unexpected error occurred.' }
    ],
    [
      'cancelLogin',
      new Error('cancel failed'),
      { title: 'Could not cancel Cherry Cloud sign-in', description: 'An unexpected error occurred.' }
    ],
    [
      'login',
      new IpcError(cherryCloudErrorCodes.SIGN_IN_FAILED, 'PRIVATE_MESSAGE', {
        reason: 'network',
        phase: 'authorization'
      }),
      {
        title: 'Cherry Cloud sign-in failed',
        description: 'During authorization request: A network error prevented sign-in.'
      }
    ],
    ['revokeSession', new Error('revoke failed'), enUs['settings.provider.cherry_cloud.logout_failed']]
  ] as const)('translates %s failures', async (action, error, message) => {
    const { result } = renderHook(() => useCherryAccountSession())
    await waitFor(() => expect(result.current.loadState).toBe('ready'))
    mocks.ipcRequest.mockRejectedValueOnce(error)

    await act(() => result.current[action]())

    expect(mocks.toastError).toHaveBeenCalledWith(message)
    expect(result.current.isStartingLogin).toBe(false)
    expect(result.current.status).toEqual(signedOut)
  })
})
