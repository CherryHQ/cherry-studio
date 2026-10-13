import { MockCacheUtils, mockCacheService } from '@test-mocks/renderer/CacheService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMiniAppPopup } from '../useMiniAppPopup'
import { createMiniApp } from './fixtures/miniApp'

const mocks = vi.hoisted(() => ({ openTab: vi.fn(), request: vi.fn(async () => {}), hasContext: true }))
vi.mock('@renderer/hooks/tab', () => ({
  useOptionalTabsContext: () => (mocks.hasContext ? { openTab: mocks.openTab } : null)
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
beforeEach(() => {
  vi.clearAllMocks()
  MockCacheUtils.resetMocks()
  mocks.hasContext = true
})

describe('MiniApp navigation', () => {
  it('opens a real background tab when selecting the secondary pane', () => {
    const { result } = renderHook(useMiniAppPopup)
    act(() => result.current.openMiniAppInSplit(createMiniApp('b')))
    expect(mocks.openTab).toHaveBeenCalledWith('/app/mini-app/b', expect.objectContaining({ placement: 'secondary' }))
  })

  it('publishes the latest transient descriptor for detached windows before opening its tab', () => {
    const { result } = renderHook(useMiniAppPopup)
    const config = { appId: 'transient', name: 'Preview', url: 'https://example.com/one' }
    act(() => result.current.openSmartMiniApp(config))
    act(() => result.current.openSmartMiniApp({ ...config, url: 'https://example.com/two' }))
    expect(mockCacheService.getShared('mini_app.transient_descriptor.transient')).toMatchObject({
      url: 'https://example.com/two'
    })
    expect(mocks.openTab).toHaveBeenLastCalledWith(
      '/app/mini-app/transient',
      expect.objectContaining({ metadata: { transientMiniApp: true } })
    )
  })

  it('uses the external opener in windows without a tab host', () => {
    mocks.hasContext = false
    const { result } = renderHook(useMiniAppPopup)
    act(() => result.current.openSmartMiniApp({ appId: 'external', name: 'External', url: 'https://example.com' }))
    expect(mocks.request).toHaveBeenCalledWith('system.shell.open_external_website', 'https://example.com')
    expect(mocks.openTab).not.toHaveBeenCalled()
  })
})
