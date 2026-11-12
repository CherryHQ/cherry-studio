import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'

import { type InstallPreview, useMiniAppInstallPreview } from '../useMiniAppInstallPreview'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function preview(installToken: string): InstallPreview {
  return {
    kind: 'install',
    source: 'builtin',
    installToken,
    iconDataUrl: null,
    manifest: {
      id: 'com.example.animation',
      name: 'Animation',
      description: 'An animation example.',
      version: '1.0.0',
      entry: 'index.html',
      permissions: [],
      optionalPermissions: [],
      network: []
    },
    required: [],
    optional: []
  }
}

describe('useMiniAppInstallPreview request ownership', () => {
  beforeEach(() => {
    vi.mocked(ipcApi.request).mockReset().mockResolvedValue(undefined)
  })

  it('releases a late cancelled preview without replacing the new request or ending its loading state', async () => {
    const stale = deferred<InstallPreview>()
    const current = deferred<InstallPreview>()
    const { result } = renderHook(() => useMiniAppInstallPreview(vi.fn()))
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = result.current.settle(() => stale.promise, 'miniApp.install.preview_error')
    })
    act(() => result.current.cancelPreview())
    expect(result.current.busy).toBe(false)
    act(() => {
      second = result.current.settle(() => current.promise, 'miniApp.install.preview_error')
    })

    await act(async () => {
      stale.resolve(preview('cancelled-token'))
      await first
    })

    expect(result.current.preview).toBeNull()
    expect(result.current.busy).toBe(true)
    expect(ipcApi.request).toHaveBeenCalledWith('mini_app.install.cancel_preview', { installToken: 'cancelled-token' })
    await act(async () => {
      current.resolve(preview('current-token'))
      await second
    })
    expect(result.current.preview).toMatchObject({ installToken: 'current-token' })
    expect(result.current.busy).toBe(false)
  })

  it('ignores a superseded failure while the newer preview is loading', async () => {
    const stale = deferred<InstallPreview>()
    const current = deferred<InstallPreview>()
    const { result } = renderHook(() => useMiniAppInstallPreview(vi.fn()))
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = result.current.settle(() => stale.promise, 'miniApp.install.preview_error')
      second = result.current.settle(() => current.promise, 'miniApp.install.preview_error')
    })

    await act(async () => {
      stale.reject(new Error('Old preview failed'))
      await first
    })

    expect(result.current.error).toBeNull()
    expect(result.current.busy).toBe(true)
    await act(async () => {
      current.resolve(preview('current-token'))
      await second
    })
    expect(result.current.preview).toMatchObject({ installToken: 'current-token' })
  })

  it.each(['success', 'failure'] as const)(
    'does not close the reopened flow after an older install %s',
    async (outcome) => {
      const install = deferred<unknown>()
      const current = deferred<InstallPreview>()
      vi.mocked(ipcApi.request).mockImplementation((async (route: string) => {
        if (route === 'mini_app.install.confirm') return install.promise
        return undefined
      }) as typeof ipcApi.request)
      const onDone = vi.fn()
      const { result } = renderHook(() => useMiniAppInstallPreview(onDone))
      await act(() =>
        result.current.settle(() => Promise.resolve(preview('old-token')), 'miniApp.install.preview_error')
      )
      let confirmation!: Promise<void>
      let nextPreview!: Promise<void>
      act(() => {
        confirmation = result.current.confirm({ grantedOptional: [] })
      })
      act(() => {
        result.current.cancelPreview()
        nextPreview = result.current.settle(() => current.promise, 'miniApp.install.preview_error')
      })

      await act(async () => {
        if (outcome === 'success') install.resolve(undefined)
        else install.reject(new Error('Old install failed'))
        await confirmation
      })

      expect(onDone).not.toHaveBeenCalled()
      expect(result.current.error).toBeNull()
      expect(result.current.busy).toBe(true)
      await act(async () => {
        current.resolve(preview('new-token'))
        await nextPreview
      })
      expect(result.current.preview).toMatchObject({ installToken: 'new-token' })
      expect(result.current.busy).toBe(false)
    }
  )
})
