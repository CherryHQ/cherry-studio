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

  it('hides then shows a visible app back at its original index, not the tail', () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    const first = mocks.miniApps[0]

    act(() => result.current.hide(first))
    expect(result.current.visible.map((a) => a.appId)).toEqual(['b'])
    expect(result.current.hidden.map((a) => a.appId)).toEqual(['c', 'a'])

    act(() => result.current.show(first))
    expect(result.current.visible.map((a) => a.appId)).toEqual(['a', 'b'])
    expect(result.current.hidden.map((a) => a.appId)).toEqual(['c'])
    expect(mocks.updateAppStatus).toHaveBeenLastCalledWith('a', 'enabled', { before: 'b' })
    expect(mocks.reorderMiniAppsByStatus).not.toHaveBeenCalled()
  })

  it('restores two hidden apps to original order even when shown in reverse', () => {
    mocks.miniApps = [stubApp('a'), stubApp('b'), stubApp('c')]
    mocks.disabled = []
    mocks.allApps = [...mocks.miniApps]
    const { result } = renderHook(() => useMiniAppVisibility())

    act(() => result.current.hide(mocks.miniApps[0]))
    act(() => result.current.hide(result.current.visible[0]))
    expect(result.current.visible.map((a) => a.appId)).toEqual(['c'])

    act(() => result.current.show(stubApp('a')))
    act(() => result.current.show(stubApp('b')))
    expect(result.current.visible.map((a) => a.appId)).toEqual(['a', 'b', 'c'])
  })

  it('reset restores hidden apps to their original visible rank instead of appending', () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    const first = mocks.miniApps[0]

    act(() => result.current.hide(first))
    expect(result.current.visible.map((a) => a.appId)).toEqual(['b'])

    act(() => result.current.reset())
    expect(result.current.hidden).toEqual([])
    expect(result.current.visible.map((a) => a.appId)).toEqual(['a', 'b', 'c'])
    expect(mocks.setAppStatusBulk).toHaveBeenCalledWith([
      { appId: 'a', status: 'enabled', order: { before: 'b' } },
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

  it('restores before a region-hidden successor without changing their persisted order', () => {
    const regionHidden: MiniApp = { ...stubApp('cn-only'), kind: 'site', supportedRegions: ['CN'] }
    mocks.miniApps = [stubApp('a'), stubApp('b')]
    mocks.disabled = []
    mocks.allApps = [mocks.miniApps[0], regionHidden, mocks.miniApps[1]]
    const { result } = renderHook(() => useMiniAppVisibility())

    act(() => result.current.hide(mocks.miniApps[0]))
    act(() => result.current.show(result.current.hidden[0]))

    expect(mocks.updateAppStatus).toHaveBeenLastCalledWith('a', 'enabled', { before: 'cn-only' })
  })

  it('restores an original tail row before a newly created row', () => {
    const { result, rerender } = renderHook(() => useMiniAppVisibility())
    const originalTail = mocks.miniApps[1]

    act(() => result.current.hide(originalTail))
    mocks.miniApps = [mocks.miniApps[0], stubApp('new-app')]
    mocks.disabled = [{ ...originalTail, status: 'disabled' }]
    mocks.allApps = [...mocks.miniApps, ...mocks.disabled]
    rerender()

    act(() => result.current.show(originalTail))

    expect(result.current.visible.map((app) => app.appId)).toEqual(['a', 'b', 'new-app'])
    expect(mocks.updateAppStatus).toHaveBeenLastCalledWith('b', 'enabled', { before: 'new-app' })
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
