import { act, renderHook, waitFor } from '@testing-library/react'
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

import { useCherryCloudSession } from '../useCherryCloudSession'

const signedOut = { phase: 'signed-out' as const, displayName: null }
const signedIn = { phase: 'signed-in' as const, displayName: 'Sora' }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useCherryCloudSession', () => {
  beforeEach(() => {
    mocks.ipcRequest.mockReset().mockResolvedValue(signedOut)
    mocks.statusChanged = undefined
    mocks.toastError.mockReset()
  })

  it('does not let an older status request overwrite a newer status event', async () => {
    const pendingStatus = deferred<typeof signedOut>()
    mocks.ipcRequest.mockReturnValueOnce(pendingStatus.promise)
    const { result } = renderHook(() => useCherryCloudSession())

    act(() => mocks.statusChanged?.(signedIn))
    expect(result.current.status).toEqual(signedIn)

    await act(async () => {
      pendingStatus.resolve(signedOut)
      await pendingStatus.promise
    })
    expect(result.current.status).toEqual(signedIn)
  })

  it.each([
    ['login', 'cherry_cloud.login.start', 'isStartingLogin', { phase: 'authorizing', displayName: null }],
    ['cancelLogin', 'cherry_cloud.login.cancel', 'isCancellingLogin', signedOut],
    ['revokeSession', 'cherry_cloud.session.revoke', 'isRevokingSession', signedOut]
  ] as const)('runs %s with an isolated loading state', async (action, route, pendingFlag, nextStatus) => {
    const pendingAction = deferred<typeof nextStatus>()
    const { result } = renderHook(() => useCherryCloudSession())
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
    ['cancelLogin', new Error('cancel failed'), 'settings.provider.cherry_cloud.sign_in_failed'],
    ['revokeSession', new Error('revoke failed'), 'settings.provider.cherry_cloud.logout_failed']
  ] as const)('translates %s failures', async (action, error, message) => {
    const { result } = renderHook(() => useCherryCloudSession())
    await waitFor(() => expect(result.current.loadState).toBe('ready'))
    mocks.ipcRequest.mockRejectedValueOnce(error)

    await act(() => result.current[action]())

    expect(mocks.toastError).toHaveBeenCalledWith(message)
  })
})
