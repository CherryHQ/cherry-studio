import { toast } from '@renderer/services/toast'
import type { MiniApp } from '@shared/data/types/miniApp'
import { resetToastMocks } from '@test-mocks/renderer/toast'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMiniAppVisibility } from '../useMiniAppVisibility'

const stubApp = (id: string): MiniApp => ({
  kind: 'site',
  appId: id,
  name: id,
  url: `https://${id}.example.com`,
  presetMiniAppId: id as MiniApp['presetMiniAppId'],
  status: 'enabled',
  orderKey: 'a0'
})

const mocks = vi.hoisted(() => ({
  allApps: [] as MiniApp[],
  miniApps: [] as MiniApp[],
  disabled: [] as MiniApp[],
  effectiveRegion: 'Global' as 'CN' | 'Global',
  updateAppStatus: vi.fn().mockResolvedValue(undefined),
  setAppStatusBulk: vi.fn().mockResolvedValue(undefined),
  reorderMiniAppsByStatus: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    allApps: mocks.allApps,
    miniApps: mocks.miniApps,
    disabled: mocks.disabled,
    effectiveRegion: mocks.effectiveRegion,
    updateAppStatus: mocks.updateAppStatus,
    setAppStatusBulk: mocks.setAppStatusBulk,
    reorderMiniAppsByStatus: mocks.reorderMiniAppsByStatus
  })
}))

describe('useMiniAppVisibility', () => {
  beforeEach(() => {
    mocks.miniApps = [stubApp('a'), stubApp('b')]
    mocks.disabled = [{ ...stubApp('c'), status: 'disabled' }]
    mocks.allApps = [...mocks.miniApps, ...mocks.disabled]
    mocks.effectiveRegion = 'Global'
    mocks.updateAppStatus.mockClear()
    mocks.setAppStatusBulk.mockClear()
    mocks.reorderMiniAppsByStatus.mockClear()
    resetToastMocks()
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

  it('show flips a single row to enabled via updateAppStatus', () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.show(mocks.disabled[0]))

    expect(result.current.visible.map((a) => a.appId)).toEqual(['a', 'b', 'c'])
    expect(result.current.hidden).toEqual([])
    expect(mocks.updateAppStatus).toHaveBeenCalledWith('c', 'enabled', { position: 'last' })
    expect(mocks.reorderMiniAppsByStatus).not.toHaveBeenCalled()
  })

  it('hides then shows a visible app back at its original index, not the tail', async () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    const first = mocks.miniApps[0]

    act(() => result.current.hide(first))
    expect(result.current.visible.map((a) => a.appId)).toEqual(['b'])
    expect(result.current.hidden.map((a) => a.appId)).toEqual(['c', 'a'])

    act(() => result.current.show(first))
    expect(result.current.visible.map((a) => a.appId)).toEqual(['a', 'b'])
    expect(result.current.hidden.map((a) => a.appId)).toEqual(['c'])
    await waitFor(() => expect(mocks.updateAppStatus).toHaveBeenCalledTimes(2))
    expect(mocks.updateAppStatus).toHaveBeenLastCalledWith('a', 'enabled', { before: 'b' })
    expect(mocks.reorderMiniAppsByStatus).not.toHaveBeenCalled()
  })

  it('serializes rapid reverse-order restores without losing an app or persisting stale anchors', async () => {
    mocks.miniApps = [stubApp('a'), stubApp('b'), stubApp('c')]
    mocks.disabled = []
    mocks.allApps = [...mocks.miniApps]
    const { result, rerender } = renderHook(() => useMiniAppVisibility())

    act(() => result.current.hide(mocks.miniApps[0]))
    act(() => result.current.hide(result.current.visible[0]))
    expect(result.current.visible.map((a) => a.appId)).toEqual(['c'])
    await waitFor(() => expect(mocks.updateAppStatus).toHaveBeenCalledTimes(2))

    const hiddenA = { ...stubApp('a'), status: 'disabled' as const }
    const hiddenB = { ...stubApp('b'), status: 'disabled' as const }
    mocks.miniApps = [stubApp('c')]
    mocks.disabled = [hiddenA, hiddenB]
    mocks.allApps = [...mocks.miniApps, ...mocks.disabled]
    rerender()

    const firstRestore = Promise.withResolvers<void>()
    mocks.updateAppStatus.mockClear()
    mocks.updateAppStatus.mockImplementationOnce(() => firstRestore.promise)
    act(() => {
      result.current.show(hiddenB)
      result.current.show(hiddenA)
    })

    expect(result.current.visible.map((a) => a.appId)).toEqual(['a', 'b', 'c'])
    expect(mocks.updateAppStatus).toHaveBeenCalledTimes(1)
    expect(mocks.updateAppStatus).toHaveBeenNthCalledWith(1, 'b', 'enabled', { before: 'c' })

    firstRestore.resolve()
    await waitFor(() => expect(mocks.updateAppStatus).toHaveBeenCalledTimes(2))
    expect(mocks.updateAppStatus).toHaveBeenNthCalledWith(2, 'a', 'enabled', { before: 'b' })
  })

  it('recomputes a queued restore anchor after an earlier restore fails', async () => {
    mocks.miniApps = [stubApp('a'), stubApp('b'), stubApp('c')]
    mocks.disabled = []
    mocks.allApps = [...mocks.miniApps]
    const { result, rerender } = renderHook(() => useMiniAppVisibility())

    act(() => result.current.hide(mocks.miniApps[0]))
    act(() => result.current.hide(result.current.visible[0]))
    await waitFor(() => expect(mocks.updateAppStatus).toHaveBeenCalledTimes(2))

    const hiddenA = { ...stubApp('a'), status: 'disabled' as const }
    const hiddenB = { ...stubApp('b'), status: 'disabled' as const }
    mocks.miniApps = [stubApp('c')]
    mocks.disabled = [hiddenA, hiddenB]
    mocks.allApps = [...mocks.miniApps, ...mocks.disabled]
    rerender()

    const firstRestore = Promise.withResolvers<void>()
    mocks.updateAppStatus.mockClear()
    mocks.updateAppStatus.mockImplementationOnce(() => firstRestore.promise)
    act(() => {
      result.current.show(hiddenB)
      result.current.show(hiddenA)
    })

    expect(mocks.updateAppStatus).toHaveBeenNthCalledWith(1, 'b', 'enabled', { before: 'c' })

    firstRestore.reject(new Error('restore failed'))
    await waitFor(() => expect(mocks.updateAppStatus).toHaveBeenCalledTimes(2))
    expect(mocks.updateAppStatus).toHaveBeenNthCalledWith(2, 'a', 'enabled', { before: 'c' })
  })

  it('persists a hide after an in-flight show so the last visibility action wins', async () => {
    const showRequest = Promise.withResolvers<void>()
    mocks.updateAppStatus.mockImplementationOnce(() => showRequest.promise)
    const { result } = renderHook(() => useMiniAppVisibility())

    act(() => result.current.show(mocks.disabled[0]))
    const shownApp = result.current.visible.find((app) => app.appId === 'c')!
    act(() => result.current.hide(shownApp))

    expect(mocks.updateAppStatus).toHaveBeenCalledTimes(1)
    expect(mocks.updateAppStatus).toHaveBeenNthCalledWith(1, 'c', 'enabled', { position: 'last' })

    showRequest.resolve()
    await waitFor(() => expect(mocks.updateAppStatus).toHaveBeenCalledTimes(2))
    expect(mocks.updateAppStatus).toHaveBeenNthCalledWith(2, 'c', 'disabled')
  })

  it('reset restores the canonical order when pinned and enabled apps are interleaved', async () => {
    const enabledFirst = { ...stubApp('a'), orderKey: 'a0' }
    const pinnedMiddle = { ...stubApp('p'), status: 'pinned' as const, orderKey: 'a1' }
    const enabledLast = { ...stubApp('b'), orderKey: 'a2' }
    mocks.miniApps = [enabledFirst, pinnedMiddle, enabledLast]
    mocks.disabled = [{ ...stubApp('c'), status: 'disabled', orderKey: 'b0' }]
    // The API groups rows by status, while miniApps exposes the shared visible
    // partition in canonical orderKey order.
    mocks.allApps = [pinnedMiddle, enabledFirst, enabledLast, ...mocks.disabled]
    const { result } = renderHook(() => useMiniAppVisibility())

    act(() => result.current.hide(enabledFirst))
    expect(result.current.visible.map((a) => a.appId)).toEqual(['p', 'b'])

    act(() => result.current.reset())
    expect(result.current.hidden).toEqual([])
    expect(result.current.visible.map((a) => a.appId)).toEqual(['a', 'p', 'b', 'c'])
    await waitFor(() => expect(mocks.setAppStatusBulk).toHaveBeenCalledTimes(1))
    expect(mocks.setAppStatusBulk).toHaveBeenCalledWith([
      { appId: 'a', status: 'enabled', order: { before: 'p' } },
      { appId: 'c', status: 'enabled', order: { position: 'last' } }
    ])
    expect(mocks.reorderMiniAppsByStatus).not.toHaveBeenCalled()
  })

  it('reset restores the original visible order after swap promotes a hidden app', () => {
    const { result } = renderHook(() => useMiniAppVisibility())

    act(() => result.current.swap())
    expect(result.current.visible.map((app) => app.appId)).toEqual(['c'])

    act(() => result.current.reset())
    expect(result.current.visible.map((app) => app.appId)).toEqual(['a', 'b', 'c'])
  })

  it('swap explicitly names every row in the move and keeps pinned rows visible', () => {
    // visible includes a pinned row that must stay in the visible column AND
    // must not appear in the bulk update.
    const pinnedApp = { ...stubApp('p'), status: 'pinned' as const }
    mocks.miniApps = [stubApp('a'), pinnedApp]
    mocks.disabled = [{ ...stubApp('c'), status: 'disabled' }]
    mocks.allApps = [...mocks.miniApps, ...mocks.disabled]

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
    expect(updates).toEqual([{ appId: 'c', status: 'enabled', order: { position: 'last' } }])
  })

  it('reorderVisible reorders within the combined visible list', async () => {
    mocks.miniApps = [stubApp('a'), { ...stubApp('p'), status: 'pinned' }, stubApp('b')]
    mocks.allApps = [...mocks.miniApps]

    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.reorderVisible(0, 1))
    expect(result.current.visible.map((a) => a.appId)).toEqual(['p', 'a', 'b'])
    await waitFor(() => expect(mocks.reorderMiniAppsByStatus).toHaveBeenCalledWith('visible', result.current.visible))
  })

  it('restores the latest dragged visible order after hide then show', () => {
    mocks.miniApps = [stubApp('a'), stubApp('b'), stubApp('c')]
    mocks.disabled = []
    mocks.allApps = [...mocks.miniApps]
    const { result } = renderHook(() => useMiniAppVisibility())

    act(() => result.current.reorderVisible(2, 0))
    expect(result.current.visible.map((a) => a.appId)).toEqual(['c', 'a', 'b'])

    const dragged = result.current.visible[0]
    act(() => result.current.hide(dragged))
    act(() => result.current.show(dragged))

    expect(result.current.visible.map((a) => a.appId)).toEqual(['c', 'a', 'b'])
  })

  it('keeps a still-hidden app in its remembered slot when the visible list is dragged', () => {
    mocks.miniApps = [stubApp('a'), stubApp('b'), stubApp('c')]
    mocks.disabled = []
    mocks.allApps = [...mocks.miniApps]
    const { result } = renderHook(() => useMiniAppVisibility())

    act(() => result.current.hide(stubApp('b')))
    act(() => result.current.reorderVisible(1, 0))
    act(() => result.current.show(stubApp('b')))

    expect(result.current.visible.map((a) => a.appId)).toEqual(['c', 'b', 'a'])
  })

  it('uses the current region order when restoring an app introduced by a region change', () => {
    const { result, rerender } = renderHook(() => useMiniAppVisibility())

    mocks.effectiveRegion = 'CN'
    mocks.miniApps = [stubApp('cn-only'), ...mocks.miniApps]
    mocks.allApps = [...mocks.miniApps, ...mocks.disabled]
    rerender()

    act(() => result.current.hide(result.current.visible[0]))
    act(() => result.current.show(result.current.hidden.at(-1)!))

    expect(result.current.visible.map((app) => app.appId)).toEqual(['cn-only', 'a', 'b'])
  })

  it('restores before a region-hidden successor without changing their persisted order', async () => {
    const regionHidden: MiniApp = { ...stubApp('cn-only'), kind: 'site', supportedRegions: ['CN'] }
    mocks.miniApps = [stubApp('a'), stubApp('b')]
    mocks.disabled = []
    mocks.allApps = [mocks.miniApps[0], regionHidden, mocks.miniApps[1]]
    const { result } = renderHook(() => useMiniAppVisibility())

    act(() => result.current.hide(mocks.miniApps[0]))
    act(() => result.current.show(result.current.hidden[0]))

    await waitFor(() => expect(mocks.updateAppStatus).toHaveBeenCalledTimes(2))
    expect(mocks.updateAppStatus).toHaveBeenLastCalledWith('a', 'enabled', { before: 'cn-only' })
  })

  it('restores an original tail row before a newly created row', async () => {
    const { result, rerender } = renderHook(() => useMiniAppVisibility())
    const originalTail = mocks.miniApps[1]

    act(() => result.current.hide(originalTail))
    mocks.miniApps = [mocks.miniApps[0], stubApp('new-app')]
    mocks.disabled = [{ ...originalTail, status: 'disabled' }]
    mocks.allApps = [...mocks.miniApps, ...mocks.disabled]
    rerender()

    act(() => result.current.show(originalTail))

    expect(result.current.visible.map((app) => app.appId)).toEqual(['a', 'b', 'new-app'])
    await waitFor(() => expect(mocks.updateAppStatus).toHaveBeenCalledTimes(2))
    expect(mocks.updateAppStatus).toHaveBeenLastCalledWith('b', 'enabled', { before: 'new-app' })
  })

  it('restores an original tail row before the earliest introduced row across visible statuses', async () => {
    const originalTail = { ...stubApp('b'), orderKey: 'a1' }
    mocks.miniApps = [{ ...stubApp('a'), orderKey: 'a0' }, originalTail]
    mocks.disabled = []
    mocks.allApps = [...mocks.miniApps]
    const { result, rerender } = renderHook(() => useMiniAppVisibility())

    act(() => result.current.hide(originalTail))
    const introducedEnabled = { ...stubApp('new-enabled'), orderKey: 'a2' }
    const introducedPinned = { ...stubApp('new-pinned'), status: 'pinned' as const, orderKey: 'a3' }
    mocks.miniApps = [mocks.miniApps[0], introducedEnabled, introducedPinned]
    mocks.disabled = [{ ...originalTail, status: 'disabled' }]
    // The API groups pinned rows ahead of enabled rows even when their shared
    // visible orderKey places the enabled row first.
    mocks.allApps = [introducedPinned, mocks.miniApps[0], introducedEnabled, ...mocks.disabled]
    rerender()

    act(() => result.current.show(originalTail))

    expect(result.current.visible.map((app) => app.appId)).toEqual(['a', 'b', 'new-enabled', 'new-pinned'])
    await waitFor(() => expect(mocks.updateAppStatus).toHaveBeenCalledTimes(2))
    expect(mocks.updateAppStatus).toHaveBeenLastCalledWith('b', 'enabled', { before: 'new-enabled' })
  })

  it('does not remember an order that failed to persist', async () => {
    mocks.reorderMiniAppsByStatus.mockRejectedValueOnce(new Error('reorder failed'))
    const original = [...mocks.miniApps]
    const { result, rerender } = renderHook(() => useMiniAppVisibility())

    act(() => result.current.reorderVisible(1, 0))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())

    mocks.miniApps = [...original]
    mocks.allApps = [...mocks.miniApps, ...mocks.disabled]
    rerender()
    act(() => result.current.hide(original[0]))
    act(() => result.current.show(original[0]))

    expect(result.current.visible.map((app) => app.appId)).toEqual(['a', 'b'])
  })

  it('persists overlapping visible reorders in user-action order', async () => {
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    mocks.miniApps = [stubApp('a'), stubApp('b'), stubApp('c')]
    mocks.allApps = [...mocks.miniApps]
    mocks.disabled = []
    mocks.reorderMiniAppsByStatus
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const { result } = renderHook(() => useMiniAppVisibility())

    act(() => result.current.reorderVisible(2, 0))
    await waitFor(() => expect(mocks.reorderMiniAppsByStatus).toHaveBeenCalledTimes(1))
    act(() => result.current.reorderVisible(2, 1))

    expect(mocks.reorderMiniAppsByStatus).toHaveBeenCalledTimes(1)
    first.resolve()
    await waitFor(() => expect(mocks.reorderMiniAppsByStatus).toHaveBeenCalledTimes(2))
    second.resolve()
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
    mocks.allApps = [...mocks.miniApps]

    const { result, rerender } = renderHook(() => useMiniAppVisibility())
    expect(result.current.visible.find((x) => x.appId === 'a')?.status).toBe('enabled')

    // Simulate upstream PATCH landing: status flip but same membership/order.
    mocks.miniApps = [{ ...stubApp('a'), status: 'pinned' }, stubApp('b')]
    mocks.allApps = [...mocks.miniApps]
    rerender()

    expect(result.current.visible.find((x) => x.appId === 'a')?.status).toBe('pinned')

    // Now swap must keep 'a' visible (it's pinned), only 'b' (enabled) moves.
    act(() => result.current.swap())
    expect(result.current.visible.map((x) => x.appId)).toContain('a')
    expect(result.current.hidden.map((x) => x.appId)).not.toContain('a')
  })
})
