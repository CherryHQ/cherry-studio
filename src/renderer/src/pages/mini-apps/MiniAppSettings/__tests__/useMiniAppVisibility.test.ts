import type { MiniApp } from '@shared/data/types/miniApp'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMiniAppVisibility } from '../useMiniAppVisibility'

const stubApp = (id: string): MiniApp => ({
  appId: id,
  name: id,
  url: `https://${id}.example.com`,
  presetMiniappId: id as MiniApp['presetMiniappId'],
  status: 'enabled',
  orderKey: 'a0'
})

const mocks = vi.hoisted(() => ({
  miniapps: [] as MiniApp[],
  disabled: [] as MiniApp[],
  updateAppStatus: vi.fn(),
  setAppStatusBulk: vi.fn(),
  reorderMiniAppsByStatus: vi.fn()
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    miniapps: mocks.miniapps,
    disabled: mocks.disabled,
    updateAppStatus: mocks.updateAppStatus,
    setAppStatusBulk: mocks.setAppStatusBulk,
    reorderMiniAppsByStatus: mocks.reorderMiniAppsByStatus
  })
}))

describe('useMiniAppVisibility', () => {
  beforeEach(() => {
    mocks.miniapps = [stubApp('a'), stubApp('b')]
    mocks.disabled = [stubApp('c')]
    mocks.updateAppStatus.mockClear()
    mocks.setAppStatusBulk.mockClear()
    mocks.reorderMiniAppsByStatus.mockClear()
  })

  it('initializes from useMiniApps', () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    expect(result.current.visible.map((a) => a.appId)).toEqual(['a', 'b'])
    expect(result.current.hidden.map((a) => a.appId)).toEqual(['c'])
  })

  it('hide flips a single row to disabled via updateAppStatus', () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.hide(mocks.miniapps[0]))

    expect(result.current.visible.map((a) => a.appId)).toEqual(['b'])
    expect(result.current.hidden.map((a) => a.appId)).toEqual(['c', 'a'])
    expect(mocks.updateAppStatus).toHaveBeenCalledTimes(1)
    expect(mocks.updateAppStatus).toHaveBeenCalledWith('a', 'disabled')
    // Critical: command-style API never references unrelated rows, so no
    // bulk call is issued and no other row's status can drift.
    expect(mocks.setAppStatusBulk).not.toHaveBeenCalled()
  })

  it('show flips a single row to enabled via updateAppStatus', () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.show(mocks.disabled[0]))

    expect(result.current.visible.map((a) => a.appId)).toEqual(['a', 'b', 'c'])
    expect(result.current.hidden).toEqual([])
    expect(mocks.updateAppStatus).toHaveBeenCalledWith('c', 'enabled')
  })

  it('swap explicitly names every row in the move and ignores pinned rows', () => {
    // visible includes a pinned row that must stay pinned across the swap.
    const pinnedApp = { ...stubApp('p'), status: 'pinned' as const }
    mocks.miniapps = [stubApp('a'), pinnedApp]
    mocks.disabled = [stubApp('c')]

    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.swap())

    expect(result.current.visible.map((a) => a.appId)).toEqual(['c'])
    expect(result.current.hidden.map((a) => a.appId)).toEqual(['a', 'p'])

    expect(mocks.setAppStatusBulk).toHaveBeenCalledTimes(1)
    const updates = mocks.setAppStatusBulk.mock.calls[0][0] as Array<{ appId: string; status: string }>
    // 'a' (was enabled) moves to disabled; 'c' (was disabled) moves to enabled;
    // 'p' (pinned) is in the visible column but must NOT appear in the bulk call.
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

  it('region-hidden rows are never referenced when hiding a visible app (#region-bug)', () => {
    // Simulates Global mode: useMiniApps' miniapps/disabled are region-filtered.
    // The CN-only row exists in the DB but the panel doesn't see it. The
    // command-style API guarantees we never touch what we don't name.
    const cnOnly = { ...stubApp('cn1'), status: 'enabled' as const }
    void cnOnly // present in DB; intentionally not exposed to useMiniAppVisibility

    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.hide(mocks.miniapps[0]))

    // Only the user's own click was PATCHed.
    expect(mocks.updateAppStatus).toHaveBeenCalledTimes(1)
    expect(mocks.updateAppStatus).toHaveBeenCalledWith('a', 'disabled')
  })

  it('reorderVisible reorders within the visible list and calls reorderMiniAppsByStatus with the moved row partition', () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.reorderVisible(0, 1))
    expect(result.current.visible.map((a) => a.appId)).toEqual(['b', 'a'])
    expect(mocks.reorderMiniAppsByStatus).toHaveBeenCalledWith('enabled', result.current.visible)
  })

  it('reorderVisible is a no-op when oldIndex === newIndex', () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.reorderVisible(0, 0))
    expect(mocks.reorderMiniAppsByStatus).not.toHaveBeenCalled()
  })
})
