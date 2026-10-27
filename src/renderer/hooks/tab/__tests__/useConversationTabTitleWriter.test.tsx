// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TabsProvider } from '@renderer/components/layout/TabsProvider'
import { useAgentSessionAutoRenameSync, useUpdateSession } from '@renderer/hooks/agent/useSession'
import { useTabsContext } from '@renderer/hooks/tab'
import { useTopicAutoRenameSync, useTopicMutations } from '@renderer/hooks/useTopic'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

let normalTabsValue: Tab[] = []

vi.mock('@renderer/data/hooks/useCache', () => ({
  usePersistCache: (key: string) => {
    if (key === 'ui.tab.normal_tabs') return [normalTabsValue, vi.fn()]
    if (key === 'ui.tab.active_tab_id') return ['home', vi.fn()]
    return [[], vi.fn()]
  }
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } })
  }
})

const { ipcHandlers } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (payload: { topicId?: string; sessionId?: string; name?: string }) => void>()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn() },
  useIpcOn: (event: string, handler: (payload: { topicId?: string; sessionId?: string; name?: string }) => void) => {
    ipcHandlers.set(event, handler)
  }
}))

vi.mock('@renderer/hooks/useWindowInitData', () => ({
  useWindowInitData: () => null
}))

const HOME_TAB: Tab = {
  id: 'home',
  type: 'route',
  url: '/app/chat',
  title: 'Chat',
  lastAccessTime: 0,
  isDormant: false
}

function chatTab(id: string, title: string, topicId: string): Tab {
  return { id, type: 'route', url: `/app/chat?topicId=${topicId}`, title, lastAccessTime: 0, isDormant: true }
}

function workTab(id: string, title: string, sessionId: string): Tab {
  return {
    id,
    type: 'route',
    url: `/app/agents?sessionId=${sessionId}`,
    title,
    lastAccessTime: 0,
    isDormant: true
  }
}

function TabLabels() {
  const { tabs } = useTabsContext()
  return <div data-testid="labels">{tabs.map((tab) => `${tab.id}=${tab.title}`).join(',')}</div>
}

function RenameTopicButton() {
  const { updateTopic } = useTopicMutations()
  return (
    <button type="button" onClick={() => void act(() => updateTopic('topic-a', { name: 'Renamed A' }))}>
      Rename topic
    </button>
  )
}

function RenameSessionButton() {
  const { updateSession } = useUpdateSession()
  return (
    <button type="button" onClick={() => void act(() => updateSession({ id: 'session-a', name: 'Renamed S' }))}>
      Rename session
    </button>
  )
}

function ClearTopicNameButton() {
  const { updateTopic } = useTopicMutations()
  return (
    <button type="button" onClick={() => void act(() => updateTopic('topic-a', { name: '' }))}>
      Clear topic name
    </button>
  )
}

function AutoRenameSync() {
  useTopicAutoRenameSync()
  useAgentSessionAutoRenameSync()
  return null
}

function renderShell(extra: React.ReactNode) {
  return render(
    <TabsProvider initialDefaultTab={HOME_TAB}>
      <TabLabels />
      {extra}
    </TabsProvider>
  )
}

beforeEach(() => {
  normalTabsValue = []
  ipcHandlers.clear()
})

afterEach(() => {
  cleanup()
})

describe('useConversationTabTitleWriter', () => {
  it('renames an inactive Chat tab when its conversation is renamed elsewhere', async () => {
    normalTabsValue = [HOME_TAB, chatTab('tab-a', 'Original A', 'topic-a'), chatTab('tab-b', 'Other B', 'topic-b')]
    renderShell(<RenameTopicButton />)

    await waitFor(() => expect(screen.getByTestId('labels')).toHaveTextContent('tab-a=Original A'))

    fireEvent.click(screen.getByRole('button', { name: 'Rename topic' }))

    await waitFor(() => expect(screen.getByTestId('labels')).toHaveTextContent('tab-a=Renamed A'))
    // Only the bound tab moves, and it stayed inactive (home is active).
    expect(screen.getByTestId('labels')).toHaveTextContent('tab-b=Other B')
    expect(screen.getByTestId('labels')).toHaveTextContent('home=Chat')
  })

  it('renames an inactive Work tab when its session is renamed elsewhere', async () => {
    normalTabsValue = [HOME_TAB, workTab('tab-w', 'Original Session', 'session-a')]
    renderShell(<RenameSessionButton />)

    await waitFor(() => expect(screen.getByTestId('labels')).toHaveTextContent('tab-w=Original Session'))

    fireEvent.click(screen.getByRole('button', { name: 'Rename session' }))

    await waitFor(() => expect(screen.getByTestId('labels')).toHaveTextContent('tab-w=Renamed S'))
  })

  it('leaves the label alone when the new name is blank', async () => {
    normalTabsValue = [HOME_TAB, chatTab('tab-a', 'Original A', 'topic-a')]
    renderShell(<ClearTopicNameButton />)

    await waitFor(() => expect(screen.getByTestId('labels')).toHaveTextContent('tab-a=Original A'))

    fireEvent.click(screen.getByRole('button', { name: 'Clear topic name' }))

    // An untitled conversation falls back to its assistant name, owned by the page.
    await waitFor(() => expect(screen.getByTestId('labels')).toHaveTextContent('tab-a=Original A'))
  })

  it('relabels a background Chat tab when its conversation is named automatically', async () => {
    normalTabsValue = [HOME_TAB, chatTab('tab-a', 'Temporary A', 'topic-a'), chatTab('tab-b', 'Other B', 'topic-b')]
    renderShell(<AutoRenameSync />)

    await waitFor(() => expect(screen.getByTestId('labels')).toHaveTextContent('tab-a=Temporary A'))

    // The naming job runs in main while tab-a is dormant; its page is not mounted.
    act(() => ipcHandlers.get('ai.topic.auto_renamed')?.({ topicId: 'topic-a', name: 'Auto A' }))

    await waitFor(() => expect(screen.getByTestId('labels')).toHaveTextContent('tab-a=Auto A'))
    expect(screen.getByTestId('labels')).toHaveTextContent('tab-b=Other B')
  })

  it('relabels a background Work tab when its session is named automatically', async () => {
    normalTabsValue = [HOME_TAB, workTab('tab-w', 'Temporary S', 'session-a')]
    renderShell(<AutoRenameSync />)

    await waitFor(() => expect(screen.getByTestId('labels')).toHaveTextContent('tab-w=Temporary S'))

    act(() => ipcHandlers.get('ai.agent.session.auto_renamed')?.({ sessionId: 'session-a', name: 'Auto S' }))

    await waitFor(() => expect(screen.getByTestId('labels')).toHaveTextContent('tab-w=Auto S'))
  })
})
