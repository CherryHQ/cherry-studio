// @vitest-environment jsdom
import { TabIdProvider } from '@renderer/components/layout/TabIdProvider'
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BrowserPage } from '../BrowserPage'

vi.unmock('@cherrystudio/ui')
const tabs = vi.hoisted(() => ({
  activeTabId: 'browser-tab',
  tabs: [{ id: 'browser-tab', type: 'route', url: '/app/browser?url=https://first.test', title: 'Old title' }],
  updateTab: vi.fn()
}))
vi.mock('@renderer/hooks/tab/useTabsContext', () => ({ useOptionalTabsContext: () => tabs }))
vi.mock('@renderer/components/WebviewAnnotationControls', () => ({ WebviewAnnotationControls: () => null }))
vi.mock(
  '@renderer/data/hooks/usePreference',
  async () => (await import('@test-mocks/renderer/usePreference')).MockUsePreference
)
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn().mockResolvedValue(undefined) }, useIpcOn: vi.fn() }))

beforeEach(() => vi.clearAllMocks())

describe('Browser tab metadata', () => {
  it('follows page titles and favicons across navigation without retaining the previous website icon', () => {
    const view = render(
      <TabIdProvider tabId="browser-tab">
        <BrowserPage initialUrl="https://first.test" />
      </TabIdProvider>
    )
    const guest = view.getByTestId('webview-browser-guest')
    Object.assign(guest, {
      getWebContentsId: () => 42,
      getURL: () => 'https://first.test',
      getTitle: () => 'First website',
      canGoBack: () => false,
      canGoForward: () => false,
      isLoading: () => false
    })
    const emit = (name: string, fields = {}) =>
      act(() => {
        guest.dispatchEvent(Object.assign(new Event(name), fields))
      })
    emit('dom-ready')
    expect(tabs.updateTab).toHaveBeenLastCalledWith('browser-tab', { title: 'First website', icon: undefined })
    emit('page-favicon-updated', { favicons: ['https://first.test/favicon.ico'] })
    expect(tabs.updateTab).toHaveBeenLastCalledWith('browser-tab', {
      title: 'First website',
      icon: 'https://first.test/favicon.ico'
    })
    emit('did-start-navigation', { url: 'https://frame.test', isMainFrame: false, isInPlace: false })
    expect(tabs.updateTab).toHaveBeenLastCalledWith('browser-tab', {
      title: 'First website',
      icon: 'https://first.test/favicon.ico'
    })
    emit('did-start-navigation', { url: 'https://second.test', isMainFrame: true, isInPlace: false })
    expect(tabs.updateTab).toHaveBeenLastCalledWith('browser-tab', { title: 'https://second.test', icon: undefined })
    emit('page-title-updated', { title: 'Second website' })
    emit('page-favicon-updated', { favicons: ['https://second.test/icon.png'] })
    expect(tabs.updateTab).toHaveBeenLastCalledWith('browser-tab', {
      title: 'Second website',
      icon: 'https://second.test/icon.png'
    })
    emit('page-title-updated', { title: 'Pull requests · Second website' })
    expect(tabs.updateTab).toHaveBeenLastCalledWith('browser-tab', {
      title: 'Pull requests · Second website',
      icon: 'https://second.test/icon.png'
    })
    emit('page-favicon-updated', { favicons: [] })
    expect(tabs.updateTab).toHaveBeenLastCalledWith('browser-tab', {
      title: 'Pull requests · Second website',
      icon: undefined
    })
  })
})
