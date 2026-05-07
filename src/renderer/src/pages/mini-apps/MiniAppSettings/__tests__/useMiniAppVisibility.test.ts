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
  updateMiniApps: vi.fn(),
  updateDisabledMiniApps: vi.fn(),
  reorderMiniAppsByStatus: vi.fn()
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    miniapps: mocks.miniapps,
    disabled: mocks.disabled,
    updateMiniApps: mocks.updateMiniApps,
    updateDisabledMiniApps: mocks.updateDisabledMiniApps,
    reorderMiniAppsByStatus: mocks.reorderMiniAppsByStatus
  })
}))

describe('useMiniAppVisibility', () => {
  beforeEach(() => {
    mocks.miniapps = [stubApp('a'), stubApp('b')]
    mocks.disabled = [stubApp('c')]
    mocks.updateMiniApps.mockClear()
    mocks.updateDisabledMiniApps.mockClear()
    mocks.reorderMiniAppsByStatus.mockClear()
  })

  it('initializes from useMiniApps', () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    expect(result.current.visible.map((a) => a.appId)).toEqual(['a', 'b'])
    expect(result.current.hidden.map((a) => a.appId)).toEqual(['c'])
  })

  it('swap exchanges the two columns and persists to DataApi', () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.swap())
    expect(result.current.visible.map((a) => a.appId)).toEqual(['c'])
    expect(result.current.hidden.map((a) => a.appId)).toEqual(['a', 'b'])
    expect(mocks.updateMiniApps).toHaveBeenCalledWith(result.current.visible)
    expect(mocks.updateDisabledMiniApps).toHaveBeenCalledWith(result.current.hidden)
  })

  it('reset moves everything visible and persists', () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.reset())
    expect(result.current.visible).toEqual(mocks.miniapps)
    expect(result.current.hidden).toEqual([])
    expect(mocks.updateMiniApps).toHaveBeenCalledWith(mocks.miniapps)
    expect(mocks.updateDisabledMiniApps).toHaveBeenCalledWith([])
  })

  it('hide moves an app from visible to hidden and persists', () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.hide(mocks.miniapps[0]))
    expect(result.current.visible.map((a) => a.appId)).toEqual(['b'])
    expect(result.current.hidden.map((a) => a.appId)).toEqual(['c', 'a'])
    expect(mocks.updateMiniApps).toHaveBeenCalledTimes(1)
    expect(mocks.updateDisabledMiniApps).toHaveBeenCalledTimes(1)
  })

  it('show moves an app from hidden to visible and persists', () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.show(mocks.disabled[0]))
    expect(result.current.visible.map((a) => a.appId)).toEqual(['a', 'b', 'c'])
    expect(result.current.hidden).toEqual([])
    expect(mocks.updateMiniApps).toHaveBeenCalledTimes(1)
    expect(mocks.updateDisabledMiniApps).toHaveBeenCalledTimes(1)
  })

  it('reorderVisible reorders within the visible list and calls reorderMiniAppsByStatus with the moved row partition', () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.reorderVisible(0, 1))
    expect(result.current.visible.map((a) => a.appId)).toEqual(['b', 'a'])
    // Both seeded rows are status='enabled', so the partition matches the visible list.
    expect(mocks.reorderMiniAppsByStatus).toHaveBeenCalledWith('enabled', result.current.visible)
  })

  it('reorderVisible is a no-op when oldIndex === newIndex', () => {
    const { result } = renderHook(() => useMiniAppVisibility())
    act(() => result.current.reorderVisible(0, 0))
    expect(mocks.reorderMiniAppsByStatus).not.toHaveBeenCalled()
  })
})
