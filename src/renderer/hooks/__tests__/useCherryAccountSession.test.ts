import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type { CherryCloudAccountReceipt, CherryCloudStatus } from '@shared/ipc/schemas/cherryCloud'

import { useCherryAccountSession } from '../useCherryAccountSession'

const request = vi.mocked(window.api.ipcApi.request)
let current: CherryCloudAccountReceipt
const listeners = new Set<(receipt: CherryCloudAccountReceipt) => void>()
function receipt(phase: CherryCloudStatus['phase'], revision = 1): CherryCloudAccountReceipt {
  return {
    status: {
      phase,
      accountId: phase === 'signed-in' ? 'account-1' : null,
      displayName: null,
      scopeId: phase === 'signed-in' ? 'in' : 'out',
      revision
    },
    reason: 'initial',
    account: { freshness: 'unknown', error: null },
    models: { freshness: 'unknown', error: null },
    plans: { freshness: 'unknown', error: null }
  }
}
function publish(next: CherryCloudAccountReceipt) {
  current = next
  listeners.forEach((listener) => listener(next))
}
function wrapper() {
  const cache = new Map()
  return ({ children }: PropsWithChildren) => createElement(SWRConfig, { value: { provider: () => cache } }, children)
}
beforeEach(() => {
  vi.clearAllMocks()
  listeners.clear()
  current = receipt('signed-out')
  request.mockImplementation(async () => ({ ok: true, data: current }))
  vi.mocked(window.api.ipcApi.on).mockImplementation((event, listener) => {
    if (event === 'cherry_cloud.account_changed') listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  })
})

describe('useCherryAccountSession receipt projection', () => {
  it('keeps known status ready while its background snapshot is pending', async () => {
    const cached = wrapper()
    const first = renderHook(() => useCherryAccountSession(), { wrapper: cached })
    await waitFor(() => expect(first.result.current.loadState).toBe('ready'))
    first.unmount()
    const pending = Promise.withResolvers<{ ok: true; data: CherryCloudAccountReceipt }>()
    request.mockReturnValueOnce(pending.promise)
    const second = renderHook(() => useCherryAccountSession(), { wrapper: cached })
    expect(second.result.current.status?.phase).toBe('signed-out')
    expect(second.result.current.loadState).toBe('ready')
    await act(async () => {
      pending.resolve({ ok: true, data: receipt('signed-in', 2) })
    })
  })
  it('does not let an older request replace a newer receipt event', async () => {
    const pending = Promise.withResolvers<{ ok: true; data: CherryCloudAccountReceipt }>()
    request.mockReturnValueOnce(pending.promise)
    const { result } = renderHook(() => useCherryAccountSession(), { wrapper: wrapper() })
    act(() => publish(receipt('signed-in', 2)))
    await act(async () => {
      pending.resolve({ ok: true, data: receipt('signed-out') })
    })
    expect(result.current.status?.phase).toBe('signed-in')
  })
  it('reports a terminal login failure after normal authorizing and signed-out progress', async () => {
    const { result } = renderHook(() => useCherryAccountSession(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.loadState).toBe('ready'))
    const pending = Promise.withResolvers<never>()
    request.mockImplementationOnce(() => pending.promise)
    let login!: Promise<void>
    act(() => {
      login = result.current.login()
    })
    act(() => publish(receipt('authorizing', 2)))
    act(() => publish(receipt('signed-out', 3)))
    await act(async () => {
      pending.reject(new Error('browser unavailable'))
      await login
    })
    expect(toast.error).toHaveBeenCalledOnce()
    expect(result.current.isAuthorizing).toBe(false)
    expect(result.current.status?.phase).toBe('signed-out')
  })
  it.each(['login', 'cancelLogin', 'revokeSession'] as const)(
    'settles %s from the owner and reloads its snapshot',
    async (action) => {
      const { result } = renderHook(() => useCherryAccountSession(), { wrapper: wrapper() })
      await waitFor(() => expect(result.current.loadState).toBe('ready'))
      request.mockImplementationOnce(async () => {
        current = receipt(action === 'login' ? 'signed-in' : 'signed-out', 2)
        return {
          ok: true,
          data: action === 'login' ? { outcome: 'signed-in', status: current.status } : current.status
        }
      })
      await act(() => result.current[action]())
      expect(result.current.status?.phase).toBe(action === 'login' ? 'signed-in' : 'signed-out')
      expect(
        result.current.isStartingLogin || result.current.isCancellingLogin || result.current.isRevokingSession
      ).toBe(false)
    }
  )
  it('does not report an abandoned component action failure', async () => {
    const pending = Promise.withResolvers<never>()
    const hook = renderHook(() => useCherryAccountSession(), { wrapper: wrapper() })
    await waitFor(() => expect(hook.result.current.loadState).toBe('ready'))
    request.mockReturnValueOnce(pending.promise)
    const login = hook.result.current.login()
    hook.unmount()
    await act(async () => {
      pending.reject(new Error('late'))
      await login
    })
    expect(toast.error).not.toHaveBeenCalled()
  })
})
