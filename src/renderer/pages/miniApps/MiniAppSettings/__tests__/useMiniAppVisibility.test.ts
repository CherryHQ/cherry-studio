import { toast } from '@renderer/services/toast'
import type { MiniApp } from '@shared/data/types/miniApp'
import { resetToastMocks } from '@test-mocks/renderer/toast'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMiniAppVisibility } from '../useMiniAppVisibility'

const stubApp = (id: string): MiniApp => ({
  appId: id,
  name: id,
  url: `https://${id}.example.com`,
  presetMiniAppId: id as MiniApp['presetMiniAppId'],
  status: 'enabled',
  orderKey: 'a0'
})

const mocks = vi.hoisted(() => ({
  miniApps: [] as MiniApp[],
  disabled: [] as MiniApp[],
  updateAppStatus: vi.fn().mockResolvedValue(undefined),
  setAppStatusBulk: vi.fn().mockResolvedValue(undefined),
  reorderMiniAppsByStatus: vi.fn().mockResolvedValue(undefined),
  exitMiniApp: vi.fn()
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    miniApps: mocks.miniApps,
    disabled: mocks.disabled,
    updateAppStatus: mocks.updateAppStatus,
    setAppStatusBulk: mocks.setAppStatusBulk,
    reorderMiniAppsByStatus: mocks.reorderMiniAppsByStatus,
    exitMiniApp: mocks.exitMiniApp
  })
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useMiniAppVisibility', () => {
  beforeEach(() => {
    mocks.miniApps = [stubApp('a'), stubApp('b')]
    mocks.disabled = [stubApp('c')]
    mocks.updateAppStatus.mockClear()
    mocks.setAppStatusBulk.mockClear()
    mocks.reorderMiniAppsByStatus.mockClear()
    resetToastMocks()
    mocks.exitMiniApp.mockClear()
  })

  it('hide updates only the named row so region-hidden apps cannot drift', () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.hide(mocks.miniApps[0]))

    expect(result.current.visible.map((a) => a.appId)).toEqual(['b'])
    expect(result.current.hidden.map((a) => a.appId)).toEqual(['c', 'a'])
    expect(mocks.updateAppStatus).toHaveBeenCalledTimes(1)
    expect(mocks.updateAppStatus).toHaveBeenCalledWith('a', 'disabled')
    // Critical: command-style API never references unrelated rows, so no
    // bulk call is issued and no other row's status can drift.
    expect(mocks.setAppStatusBulk).not.toHaveBeenCalled()
  })

  it('reports a failed visibility mutation to the user', async () => {
    mocks.updateAppStatus.mockRejectedValueOnce(new Error('hide failed'))
    const { result } = renderHook(() => useMiniAppVisibility())

    act(() => result.current.hide(mocks.miniApps[0]))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Internal error: hide failed')
    })
  })

  it('exits a hidden app only after its disabled status is persisted', async () => {
    const deferred = createDeferred<void>()
    mocks.updateAppStatus.mockReturnValueOnce(deferred.promise)
    const { result } = renderHook(() => useMiniAppVisibility())

    act(() => result.current.hide(mocks.miniApps[0]))
    expect(mocks.exitMiniApp).not.toHaveBeenCalled()

    deferred.resolve()
    await waitFor(() => expect(mocks.exitMiniApp).toHaveBeenCalledWith('a'))
  })

  it('does not exit an app when persisting its disabled status fails', async () => {
    const deferred = createDeferred<void>()
    mocks.updateAppStatus.mockReturnValueOnce(deferred.promise)
    const { result } = renderHook(() => useMiniAppVisibility())

    act(() => result.current.hide(mocks.miniApps[0]))
    deferred.reject(new Error('write failed'))

    await waitFor(() => expect(mocks.updateAppStatus).toHaveBeenCalledWith('a', 'disabled'))
    expect(mocks.exitMiniApp).not.toHaveBeenCalled()
  })

  it('show flips a single row to enabled via updateAppStatus', () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.show(mocks.disabled[0]))

    expect(result.current.visible.map((a) => a.appId)).toEqual(['a', 'b', 'c'])
    expect(result.current.hidden).toEqual([])
    expect(mocks.updateAppStatus).toHaveBeenCalledWith('c', 'enabled')
  })

  it('swap explicitly names every row in the move and keeps pinned rows visible', () => {
    // visible includes a pinned row that must stay in the visible column AND
    // must not appear in the bulk update.
    const pinnedApp = { ...stubApp('p'), status: 'pinned' as const }
    mocks.miniApps = [stubApp('a'), pinnedApp]
    mocks.disabled = [stubApp('c')]

    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.swap())

    // Pinned 'p' stays visible; only the enabled row 'a' actually moves.
    // Pinned must come at the head of the new visible list so the order
    // matches the post-revalidate `miniApps` (pinned has a small orderKey,
    // formerly-hidden gets a tail orderKey on the status flip). Otherwise
    // pinned briefly appears at the bottom for one render before snapping
    // to the top.
    expect(result.current.visible.map((a) => a.appId)).toEqual(['p', 'c'])
    expect(result.current.hidden.map((a) => a.appId)).toEqual(['a'])

    expect(mocks.setAppStatusBulk).toHaveBeenCalledTimes(1)
    const updates = mocks.setAppStatusBulk.mock.calls[0][0] as Array<{ appId: string; status: string }>
    expect(updates).toContainEqual({ appId: 'a', status: 'disabled' })
    expect(updates).toContainEqual({ appId: 'c', status: 'enabled' })
    expect(updates.find((u) => u.appId === 'p')).toBeUndefined()
  })

  it('reset only promotes hidden rows; does not touch visible or pinned rows', () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.reset())

    expect(result.current.hidden).toEqual([])
    expect(mocks.setAppStatusBulk).toHaveBeenCalledTimes(1)
    const updates = mocks.setAppStatusBulk.mock.calls[0][0] as Array<{ appId: string; status: string }>
    expect(updates).toEqual([{ appId: 'c', status: 'enabled' }])
  })

  it('reorderVisible reorders within the combined visible list', () => {
    mocks.miniApps = [stubApp('a'), { ...stubApp('p'), status: 'pinned' }, stubApp('b')]

    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.reorderVisible(0, 1))
    expect(result.current.visible.map((a) => a.appId)).toEqual(['p', 'a', 'b'])
    expect(mocks.reorderMiniAppsByStatus).toHaveBeenCalledWith('visible', result.current.visible)
  })

  it('reorderVisible is a no-op when oldIndex === newIndex', () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.reorderVisible(0, 0))
    expect(mocks.reorderMiniAppsByStatus).not.toHaveBeenCalled()
  })

  it('resyncs local row status when upstream flips status without changing membership', () => {
    // Reproducer for the "right-click → Add to Launchpad while panel open"
    // scenario: id sequence stays identical, but row 'a' flips enabled →
    // pinned. The old id-only comparator skipped resync, leaving a stale
    // `status='enabled'` locally — then `swap` filtered 'a' as movingToHidden
    // and dragged the now-pinned row into the hidden column.
    mocks.miniApps = [stubApp('a'), stubApp('b')]
    mocks.disabled = []

    const { result, rerender } = renderHook(() => useMiniAppVisibility())
    expect(result.current.visible.find((x) => x.appId === 'a')?.status).toBe('enabled')

    // Simulate upstream PATCH landing: status flip but same membership/order.
    mocks.miniApps = [{ ...stubApp('a'), status: 'pinned' }, stubApp('b')]
    rerender()

    expect(result.current.visible.find((x) => x.appId === 'a')?.status).toBe('pinned')

    // Now swap must keep 'a' visible (it's pinned), only 'b' (enabled) moves.
    act(() => result.current.swap())
    expect(result.current.visible.map((x) => x.appId)).toContain('a')
    expect(result.current.hidden.map((x) => x.appId)).not.toContain('a')
  })
})
