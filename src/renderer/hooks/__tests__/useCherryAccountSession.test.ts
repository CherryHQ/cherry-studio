import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

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

function createWrapper() {
  const cache = new Map()
  return ({ children }: PropsWithChildren) => createElement(SWRConfig, { value: { provider: () => cache } }, children)
}

describe('useCherryAccountSession', () => {
  beforeEach(() => {
    mocks.ipcRequest.mockReset().mockResolvedValue(signedOut)
    mocks.statusChanged = undefined
    mocks.toastError.mockReset()
  })

  it('keeps a known session ready across remounts and during background refresh', async () => {
    const wrapper = createWrapper()
    const first = renderHook(() => useCherryAccountSession(), { wrapper })
    await waitFor(() => expect(first.result.current.loadState).toBe('ready'))
    first.unmount()

    const pending = deferred<typeof signedIn>()
    mocks.ipcRequest.mockReturnValue(pending.promise)
    const second = renderHook(() => useCherryAccountSession(), { wrapper })
    expect(second.result.current.status).toEqual(signedOut)
    expect(second.result.current.loadState).toBe('ready')

    let refresh!: Promise<void>
    act(() => {
      refresh = second.result.current.reload()
    })
    expect(second.result.current.loadState).toBe('ready')
    await act(async () => {
      pending.resolve(signedIn)
      await refresh
    })
    expect(second.result.current.status).toEqual(signedIn)
  })

  it('does not let an older status request overwrite a newer status event', async () => {
    const pendingStatus = deferred<typeof signedOut>()
    mocks.ipcRequest.mockReturnValueOnce(pendingStatus.promise)
    const { result } = renderHook(() => useCherryAccountSession(), { wrapper: createWrapper() })

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
    const { result } = renderHook(() => useCherryAccountSession(), { wrapper: createWrapper() })
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
    ['login', new IpcError(cherryCloudErrorCodes.LOGIN_SERVICE_UNAVAILABLE), 'error.http.503'],
    ['login', new IpcError('CHERRY_CLOUD_UPGRADE_REQUIRED'), 'settings.provider.cherry_cloud.upgrade_required'],
    ['login', new Error('Cherry Cloud login request failed (400)'), 'settings.provider.cherry_cloud.sign_in_failed'],
    ['cancelLogin', new Error('cancel failed'), 'settings.provider.cherry_cloud.sign_in_failed'],
    ['revokeSession', new Error('revoke failed'), 'settings.provider.cherry_cloud.logout_failed']
  ] as const)('translates %s failures', async (action, error, message) => {
    const { result } = renderHook(() => useCherryAccountSession(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.loadState).toBe('ready'))
    mocks.ipcRequest.mockRejectedValueOnce(error)

    await act(() => result.current[action]())

    expect(mocks.toastError).toHaveBeenCalledWith(message)
    expect(result.current.isStartingLogin).toBe(false)
    expect(result.current.status).toEqual(signedOut)
  })
})
