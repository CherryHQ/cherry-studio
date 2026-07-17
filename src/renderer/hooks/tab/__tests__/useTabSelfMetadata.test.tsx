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
  entityAvatarTabIcon: (avatar?: { kind: string; emoji?: string; src?: string }) =>
    avatar?.kind === 'emoji' ? `icon:${avatar.emoji}` : avatar?.src
}))

import { TabIdProvider } from '@renderer/components/layout/TabIdProvider'
import { type TabSelfMetadata, useTabSelfMetadata } from '@renderer/hooks/tab/useTabSelfMetadata'

function TabMetadataWriter({ children, ...metadata }: TabSelfMetadata & { children?: ReactNode }) {
  useTabSelfMetadata(metadata)
  return <>{children}</>
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.activeTabId = 'tab-1'
  mocks.tabs = []
})

describe('useTabSelfMetadata', () => {
  it('syncs an uploaded image into the tab icon without an emoji fallback', async () => {
    mocks.tabs = [{ id: 'tab-1', type: 'route', url: '/app/chat?topicId=topic-1', title: 'Old title' }]

    render(
      <TabIdProvider tabId="tab-1">
        <TabMetadataWriter
          title="Image assistant"
          avatar={{
            kind: 'image',
            fileId: '019606a0-0000-7000-8000-000000000001',
            src: 'file:///tmp/avatar.png'
          }}
          instanceAppId="assistants"
          instanceKey="topic-1"
        />
      </TabIdProvider>
    )

    await waitFor(() =>
      expect(mocks.updateTab).toHaveBeenCalledWith('tab-1', {
        title: 'Image assistant',
        icon: 'file:///tmp/avatar.png',
        metadata: { instanceAppId: 'assistants', instanceKey: 'topic-1' }
      })
    )
  })

  it('syncs tab self metadata while the tab still belongs to the instance app route', async () => {
    mocks.tabs = [
      {
        id: 'tab-1',
        type: 'route',
        url: '/app/chat?topicId=topic-1',
        title: 'Old title',
        metadata: { keep: true }
      }
    ]

    render(
      <TabIdProvider tabId="tab-1">
        <TabMetadataWriter
          title="Topic title"
          avatar={{ kind: 'emoji', emoji: 'spark' }}
          instanceAppId="assistants"
          instanceKey="topic-1"
        />
      </TabIdProvider>
    )

    await waitFor(() =>
      expect(mocks.updateTab).toHaveBeenCalledWith('tab-1', {
        title: 'Topic title',
        icon: 'icon:spark',
        metadata: { keep: true, instanceAppId: 'assistants', instanceKey: 'topic-1' }
      })
    )
  })

  it('does not sync stale page metadata after the tab is retargeted to another route', async () => {
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
        <TabMetadataWriter
          title="Topic title"
          avatar={{ kind: 'emoji', emoji: 'spark' }}
          instanceAppId="assistants"
          instanceKey="topic-1"
        />
      </TabIdProvider>
    )

    await act(async () => {})

    expect(mocks.updateTab).not.toHaveBeenCalled()
  })

  it('lets page-titled routes update the fixed home tab title', async () => {
    mocks.tabs = [
      {
        id: 'home',
        type: 'route',
        url: '/app/agents',
        title: 'Agent',
        metadata: { keep: true }
      }
    ]

    render(
      <TabIdProvider tabId="home">
        <TabMetadataWriter
          title="Session title"
          avatar={{ kind: 'emoji', emoji: 'spark' }}
          instanceAppId="agents"
          instanceKey="session-1"
        />
      </TabIdProvider>
    )

    await waitFor(() =>
      expect(mocks.updateTab).toHaveBeenCalledWith('home', {
        title: 'Session title',
        icon: 'icon:spark',
        metadata: { keep: true, instanceAppId: 'agents', instanceKey: 'session-1' }
      })
    )
  })
})
