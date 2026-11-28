import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn<(route: string, payload?: unknown) => Promise<undefined>>(async () => undefined),
  setPinned: vi.fn(async () => undefined)
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.mock('@renderer/services/SidebarShortcutService', () => ({
  sidebarShortcutService: {
    setPinned: mocks.setPinned,
    normalize: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    reorder: vi.fn(async () => undefined)
  }
}))

import { createSidebarShortcutTarget, SIDEBAR_SHORTCUT_PROVIDER_IDS } from '@renderer/utils/sidebar'

import { useSidebarShortcuts } from '../useSidebarShortcuts'

const pinnedEvents = () =>
  mocks.request.mock.calls.filter(([route]) => route === 'analytics.track').map(([, event]) => event)

describe('useSidebarShortcuts pin analytics', () => {
  beforeEach(() => {
    mocks.request.mockClear()
    mocks.setPinned.mockReset().mockResolvedValue(undefined)
  })

  it('reports a mini app pinned to the sidebar once it is saved, never its id', async () => {
    const { result } = renderHook(() => useSidebarShortcuts())
    const miniApp = createSidebarShortcutTarget(SIDEBAR_SHORTCUT_PROVIDER_IDS.MINI_APP, 'private-app')
    const agent = createSidebarShortcutTarget(SIDEBAR_SHORTCUT_PROVIDER_IDS.AGENT, 'agent-1')

    await act(async () => {
      result.current.setPinned(miniApp, true)
      result.current.setPinned(miniApp, false)
      result.current.setPinned(agent, true)
    })
    mocks.setPinned.mockRejectedValueOnce(new Error('write failed'))
    await act(async () => {
      result.current.setPinned(miniApp, true)
    })

    expect(pinnedEvents()).toEqual([{ event: 'feature_used', feature: 'mini_app', action: 'app_pinned' }])
  })
})
