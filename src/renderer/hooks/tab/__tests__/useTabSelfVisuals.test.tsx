// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Tab } from '@shared/data/cache/cacheValueTypes'

const mocks = vi.hoisted(() => ({
  activeTabId: 'tab-1',
  tabs: [] as Tab[],
  updateTab: vi.fn()
}))

vi.mock('@renderer/hooks/tab/useTabsContext', () => ({
  useOptionalTabsContext: () => ({
    activeTabId: mocks.activeTabId,
    tabs: mocks.tabs,
    updateTab: mocks.updateTab
  })
}))

vi.mock('@renderer/utils/tabIcons', () => ({
  emojiTabIcon: (emoji?: string | null) => (emoji ? `icon:${emoji}` : undefined)
}))

import { TabIdProvider } from '@renderer/components/layout/TabIdProvider'
import { type TabSelfVisuals, useTabSelfVisuals } from '@renderer/hooks/tab/useTabSelfVisuals'

function TabVisualsWriter({ children, ...visuals }: TabSelfVisuals & { children?: ReactNode }) {
  useTabSelfVisuals(visuals)
  return <>{children}</>
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.activeTabId = 'tab-1'
  mocks.tabs = []
})

describe('useTabSelfVisuals', () => {
  it('stamps the tab title and icon while the tab belongs to the app route', async () => {
    mocks.tabs = [
      {
        id: 'tab-1',
        type: 'route',
        url: '/app/chat?topicId=topic-1',
        title: 'Old title'
      }
    ]

    render(
      <TabIdProvider tabId="tab-1">
        <TabVisualsWriter title="Topic title" emoji="spark" appId="assistants" />
      </TabIdProvider>
    )

    await waitFor(() =>
      expect(mocks.updateTab).toHaveBeenCalledWith('tab-1', {
        title: 'Topic title',
        icon: 'icon:spark'
      })
    )
  })

  it('does not stamp stale page visuals after the tab is retargeted to another route', async () => {
    mocks.tabs = [
      {
        id: 'tab-1',
        type: 'route',
        url: '/app/translate',
        title: 'Translate'
      }
    ]

    render(
      <TabIdProvider tabId="tab-1">
        <TabVisualsWriter title="Topic title" emoji="spark" appId="assistants" />
      </TabIdProvider>
    )

    await act(async () => {})

    expect(mocks.updateTab).not.toHaveBeenCalled()
  })

  it('preserves the stored title and icon while the bound conversation is loading', async () => {
    mocks.tabs = [
      {
        id: 'tab-1',
        type: 'route',
        url: '/app/chat?topicId=topic-1',
        title: 'Stored topic title',
        icon: 'icon:stored'
      }
    ]

    render(
      <TabIdProvider tabId="tab-1">
        <TabVisualsWriter title="Chat" appId="assistants" preserveVisuals />
      </TabIdProvider>
    )

    await act(async () => {})

    expect(mocks.updateTab).not.toHaveBeenCalled()
  })

  it('skips the update when title and icon already match', async () => {
    mocks.tabs = [
      {
        id: 'tab-1',
        type: 'route',
        url: '/app/agents?sessionId=session-1',
        title: 'Session title',
        icon: 'icon:spark'
      }
    ]

    render(
      <TabIdProvider tabId="tab-1">
        <TabVisualsWriter title="Session title" emoji="spark" appId="agents" />
      </TabIdProvider>
    )

    await act(async () => {})

    expect(mocks.updateTab).not.toHaveBeenCalled()
  })
})
