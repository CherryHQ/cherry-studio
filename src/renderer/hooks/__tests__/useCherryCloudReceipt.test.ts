import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CherryCloudAccountReceipt, CherryCloudAccountRefreshResult } from '@shared/ipc/schemas/cherryCloud'

import { useCherryCloudReceipt } from '../useCherryCloudReceipt'

const request = vi.mocked(window.api.ipcApi.request)
const listeners = new Set<(receipt: CherryCloudAccountReceipt) => void>()
function snapshot(scopeId: string, revision: number): CherryCloudAccountReceipt {
  return {
    status: { scopeId, revision, phase: 'signed-in', accountId: scopeId, displayName: null },
    reason: 'initial',
    account: { freshness: 'unknown', error: null },
    models: { freshness: 'unknown', error: null },
    plans: { freshness: 'unknown', error: null }
  }
}
function publish(receipt: CherryCloudAccountReceipt) {
  listeners.forEach((listener) => listener(receipt))
}
function wrapper() {
  const cache = new Map()
  return ({ children }: PropsWithChildren) => createElement(SWRConfig, { value: { provider: () => cache } }, children)
}
beforeEach(() => {
  vi.clearAllMocks()
  listeners.clear()
  request.mockResolvedValue({ ok: true, data: snapshot('a', 1) })
  vi.mocked(window.api.ipcApi.on).mockImplementation((event, listener) => {
    if (event === 'cherry_cloud.account_changed') listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  })
})

describe('useCherryCloudReceipt', () => {
  it('keeps a newer event when the initial snapshot request finishes late', async () => {
    const pending = Promise.withResolvers<{ ok: true; data: CherryCloudAccountReceipt }>()
    request.mockReturnValueOnce(pending.promise)
    const { result } = renderHook(() => useCherryCloudReceipt(), { wrapper: wrapper() })
    act(() => publish(snapshot('b', 3)))
    await act(async () => {
      pending.resolve({ ok: true, data: snapshot('a', 1) })
    })
    expect(result.current.receipt?.status).toMatchObject({ scopeId: 'b', revision: 3 })
  })
  it('applies the same RPC and event revision once', async () => {
    const { result } = renderHook(() => useCherryCloudReceipt(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.receipt?.status.revision).toBe(1))
    const next = snapshot('a', 2)
    request.mockImplementationOnce(async () => {
      publish(next)
      return { ok: true, data: { outcome: 'refreshed', receipt: next } }
    })
    await act(() => result.current.refresh('focus_refresh'))
    const accepted = result.current.receipt
    act(() => publish({ ...next }))
    expect(result.current.receipt).toBe(accepted)
    expect(result.current.receipt?.status.revision).toBe(2)
  })
  it('ignores an old scoped refresh result after a new account event', async () => {
    const { result } = renderHook(() => useCherryCloudReceipt(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.receipt?.status.scopeId).toBe('a'))
    const pending = Promise.withResolvers<{ ok: true; data: CherryCloudAccountRefreshResult }>()
    request.mockReturnValueOnce(pending.promise)
    let refresh!: Promise<CherryCloudAccountRefreshResult>
    act(() => {
      refresh = result.current.refresh('focus_refresh')
    })
    act(() => publish(snapshot('b', 3)))
    await act(async () => {
      pending.resolve({ ok: true, data: { outcome: 'refreshed', receipt: snapshot('a', 2) } })
      await refresh
    })
    expect(result.current.receipt?.status).toMatchObject({ scopeId: 'b', revision: 3 })
  })
})
