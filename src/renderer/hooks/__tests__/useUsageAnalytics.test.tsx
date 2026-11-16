import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type Tab, TabsContext, type TabsContextValue } from '@renderer/hooks/tab'
import type { RendererAnalyticsEvent } from '@shared/ipc/schemas/analytics'

import { useTabDwellTracking } from '../useUsageAnalytics'

const request = vi.mocked(window.api.ipcApi.request)
const pageViews = () =>
  request.mock.calls
    .filter(([route]) => route === 'analytics.track')
    .map(([, event]) => event as RendererAnalyticsEvent)
    .filter(({ event }) => event === 'page_viewed')

const chatTab: Tab = { id: 'tab-chat', type: 'route', url: '/app/chat/topic-1', title: 'Chat' }
const settingsTab: Tab = { id: 'tab-settings', type: 'route', url: '/settings/provider/p-1', title: 'Settings' }

function Harness() {
  useTabDwellTracking(true)
  return null
}

function tabsValue(tabs: Tab[], activeTab: Tab): TabsContextValue {
  return { tabs, activeTab, activeTabId: activeTab.id } as TabsContextValue
}

function renderTabs(tabs: Tab[], activeTab: Tab) {
  const view = render(
    <TabsContext value={tabsValue(tabs, activeTab)}>
      <Harness />
    </TabsContext>
  )
  return {
    show: (nextTabs: Tab[], nextActive: Tab) =>
      view.rerender(
        <TabsContext value={tabsValue(nextTabs, nextActive)}>
          <Harness />
        </TabsContext>
      ),
    unmount: view.unmount
  }
}

describe('useTabDwellTracking', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    request.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('times only the active tab, ending it with tab_switch or tab_close', () => {
    const tabs = renderTabs([chatTab, settingsTab], chatTab)
    vi.advanceTimersByTime(5_000)
    tabs.show([chatTab, settingsTab], settingsTab)
    vi.advanceTimersByTime(3_000)
    tabs.show([chatTab, settingsTab], chatTab)
    vi.advanceTimersByTime(4_000)
    tabs.show([settingsTab], settingsTab)

    expect(pageViews()).toEqual([
      expect.objectContaining({ page: 'chat', durationMs: 5_000, endReason: 'tab_switch' }),
      expect.objectContaining({ page: 'settings', subpage: 'provider', durationMs: 3_000, endReason: 'tab_switch' }),
      expect.objectContaining({ page: 'chat', durationMs: 4_000, endReason: 'tab_close' })
    ])
  })

  it('keeps one visit while the active tab re-renders without changing page', () => {
    const tabs = renderTabs([chatTab], chatTab)
    vi.advanceTimersByTime(2_000)
    const renamed = { ...chatTab, title: 'Renamed', url: '/app/chat/topic-2' }
    tabs.show([renamed], renamed)
    vi.advanceTimersByTime(2_000)
    tabs.unmount()

    expect(pageViews()).toEqual([expect.objectContaining({ page: 'chat', durationMs: 4_000, endReason: 'app_quit' })])
  })
})
