// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
        icon: 'icon:spark',
        metadata: { conversationEntry: undefined }
      })
    )
  })

  it('stamps the entity that owns the conversation the tab is showing', async () => {
    mocks.tabs = [{ id: 'tab-1', type: 'route', url: '/app/chat?topicId=topic-1', title: 'Old title' }]

    render(
      <TabIdProvider tabId="tab-1">
        <TabVisualsWriter title="Topic title" appId="assistants" entityId="assistant-1" />
      </TabIdProvider>
    )

    await waitFor(() =>
      expect(mocks.updateTab).toHaveBeenCalledWith('tab-1', {
        title: 'Topic title',
        icon: undefined,
        metadata: { conversationEntry: { type: 'assistant', entityId: 'assistant-1' } }
      })
    )
  })

  it('re-stamps the owner when the tab switches to another entity, even with identical visuals', async () => {
    mocks.tabs = [
      {
        id: 'tab-1',
        type: 'route',
        url: '/app/chat?topicId=topic-2',
        title: 'Shared title',
        metadata: { conversationEntry: { type: 'assistant', entityId: 'assistant-1' } }
      }
    ]

    render(
      <TabIdProvider tabId="tab-1">
        <TabVisualsWriter title="Shared title" appId="assistants" entityId="assistant-2" />
      </TabIdProvider>
    )

    await waitFor(() =>
      expect(mocks.updateTab).toHaveBeenCalledWith('tab-1', {
        title: 'Shared title',
        icon: undefined,
        metadata: { conversationEntry: { type: 'assistant', entityId: 'assistant-2' } }
      })
    )
  })

  it('keeps unrelated metadata when re-stamping the owner', async () => {
    mocks.tabs = [
      {
        id: 'tab-1',
        type: 'route',
        url: '/app/agents?sessionId=session-1',
        title: 'Old title',
        metadata: { somethingElse: 'keep me' }
      }
    ]

    render(
      <TabIdProvider tabId="tab-1">
        <TabVisualsWriter title="Session title" appId="agents" entityId="agent-9" />
      </TabIdProvider>
    )

    await waitFor(() =>
      expect(mocks.updateTab).toHaveBeenCalledWith('tab-1', {
        title: 'Session title',
        icon: undefined,
        metadata: {
          somethingElse: 'keep me',
          conversationEntry: { type: 'agent', entityId: 'agent-9' }
        }
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

  it('skips the update when title, icon and owner already match', async () => {
    mocks.tabs = [
      {
        id: 'tab-1',
        type: 'route',
        url: '/app/agents?sessionId=session-1',
        title: 'Session title',
        icon: 'icon:spark',
        metadata: { conversationEntry: { type: 'agent', entityId: 'agent-1' } }
      }
    ]

    render(
      <TabIdProvider tabId="tab-1">
        <TabVisualsWriter title="Session title" emoji="spark" appId="agents" entityId="agent-1" />
      </TabIdProvider>
    )

    await act(async () => {})

    expect(mocks.updateTab).not.toHaveBeenCalled()
  })
})
