// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { TabsProvider } from '@renderer/components/layout/TabsProvider'
import type * as DataApiModule from '@renderer/data/hooks/useDataApi'
import { useConversationTabTitleChangeSync, useTabsContext } from '@renderer/hooks/tab'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

let normalTabsValue: Tab[] = []

vi.mock('@renderer/data/hooks/useCache', () => ({
  usePersistCache: (key: string) => {
    if (key === 'ui.tab.normal_tabs') return [normalTabsValue, vi.fn()]
    if (key === 'ui.tab.active_tab_id') return ['home', vi.fn()]
    return [[], vi.fn()]
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn() },
  useIpcOn: vi.fn()
}))

vi.mock('@renderer/hooks/useWindowInitData', () => ({
  useWindowInitData: () => null
}))

const { changeListeners } = vi.hoisted(() => ({
  changeListeners: new Map<string, (effects: Array<{ endpoint: string; entityIds?: string[] }>) => void>()
}))

vi.mock('@renderer/data/hooks/useDataApi', async (importOriginal) => {
  const actual = await importOriginal<typeof DataApiModule>()
  return {
    ...actual,
    useDataChange: (endpoints: string | string[], listener: (effects: never) => void) => {
      for (const endpoint of Array.isArray(endpoints) ? endpoints : [endpoints]) {
        changeListeners.set(endpoint, listener as never)
      }
    }
  }
})

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

function CrossWindowRenameSync() {
  useConversationTabTitleChangeSync()
  return null
}

function NavigateTabAwayButton() {
  const { updateTab } = useTabsContext()
  return (
    <button type="button" onClick={() => updateTab('tab-a', { url: '/app/chat?topicId=topic-b' })}>
      Navigate away
    </button>
  )
}

function UnmountableRenameSync() {
  const [mounted, setMounted] = useState(true)
  return mounted ? (
    <>
      <CrossWindowRenameSync />
      <button type="button" onClick={() => setMounted(false)}>
        Unmount sync
      </button>
    </>
  ) : null
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
  changeListeners.clear()
})

afterEach(() => {
  cleanup()
})

describe('useConversationTabTitleChangeSync', () => {
  it('relabels a tab when another window renames its conversation', async () => {
    // A rename in another window only reaches this one as a DataApi change notification, which
    // carries no name — the label has to follow the row it points at.
    normalTabsValue = [HOME_TAB, chatTab('tab-a', 'Old A', 'topic-a'), chatTab('tab-b', 'Other B', 'topic-b')]
    const get = vi.spyOn(dataApiService, 'get').mockResolvedValue({ id: 'topic-a', name: 'Other-window A' })
    renderShell(<CrossWindowRenameSync />)

    await waitFor(() => expect(screen.getByTestId('labels')).toHaveTextContent('tab-a=Old A'))

    await act(async () => {
      changeListeners.get('/topics/:id')?.([{ endpoint: '/topics/:id', entityIds: ['topic-a'] }])
    })

    await waitFor(() => expect(screen.getByTestId('labels')).toHaveTextContent('tab-a=Other-window A'))
    expect(screen.getByTestId('labels')).toHaveTextContent('tab-b=Other B')
    // A conversation this window has no tab for is not read at all.
    expect(get).toHaveBeenCalledTimes(1)
    get.mockRestore()
  })

  it('drops a delayed cross-window rename after the tab navigated away', async () => {
    // The read-back resolves after the user navigated tab-a to another conversation;
    // the stale name must not overwrite the tab's current binding.
    normalTabsValue = [HOME_TAB, chatTab('tab-a', 'Old A', 'topic-a')]
    let resolveGet: ((row: unknown) => void) | undefined
    const get = vi
      .spyOn(dataApiService, 'get')
      .mockImplementation(() => new Promise((resolve) => (resolveGet = resolve)))
    renderShell(
      <>
        <CrossWindowRenameSync />
        <NavigateTabAwayButton />
      </>
    )

    await waitFor(() => expect(screen.getByTestId('labels')).toHaveTextContent('tab-a=Old A'))

    await act(async () => {
      changeListeners.get('/topics/:id')?.([{ endpoint: '/topics/:id', entityIds: ['topic-a'] }])
      await waitFor(() => expect(get).toHaveBeenCalled())
    })

    // Navigate tab-a away from topic-a while the read is still in flight.
    fireEvent.click(screen.getByRole('button', { name: 'Navigate away' }))

    await act(async () => {
      resolveGet?.({ id: 'topic-a', name: 'Other-window A' })
    })

    await waitFor(() => expect(screen.getByTestId('labels')).toHaveTextContent('tab-a=Old A'))
    get.mockRestore()
  })

  it('drops a pending rename whose writer unmounted before it landed', async () => {
    // History starts renaming A, then closes; the pending mutation lands after the writer's
    // snapshot stopped advancing, so its write would stamp A's name over a tab now showing B.
    normalTabsValue = [HOME_TAB, chatTab('tab-a', 'Old A', 'topic-a')]
    let resolveGet: ((row: unknown) => void) | undefined
    const get = vi
      .spyOn(dataApiService, 'get')
      .mockImplementation(() => new Promise((resolve) => (resolveGet = resolve)))
    renderShell(<UnmountableRenameSync />)

    await waitFor(() => expect(screen.getByTestId('labels')).toHaveTextContent('tab-a=Old A'))

    await act(async () => {
      changeListeners.get('/topics/:id')?.([{ endpoint: '/topics/:id', entityIds: ['topic-a'] }])
      await waitFor(() => expect(get).toHaveBeenCalled())
    })

    // The initiator unmounts; its retained snapshot must not be trusted afterwards.
    fireEvent.click(screen.getByRole('button', { name: 'Unmount sync' }))

    await act(async () => {
      resolveGet?.({ id: 'topic-a', name: 'Other-window A' })
    })

    await waitFor(() => expect(screen.getByTestId('labels')).toHaveTextContent('tab-a=Old A'))
    get.mockRestore()
  })

  it('ignores a non-Chat route that happens to carry the same query key', async () => {
    const stray: Tab = { ...chatTab('tab-x', 'Notes', 'topic-a'), url: '/app/notes?topicId=topic-a' }
    normalTabsValue = [HOME_TAB, chatTab('tab-a', 'Old A', 'topic-a'), stray]
    const get = vi.spyOn(dataApiService, 'get').mockResolvedValue({ id: 'topic-a', name: 'Renamed A' })
    renderShell(<CrossWindowRenameSync />)

    await act(async () => {
      changeListeners.get('/topics/:id')?.([{ endpoint: '/topics/:id', entityIds: ['topic-a'] }])
    })

    await waitFor(() => expect(screen.getByTestId('labels')).toHaveTextContent('tab-a=Renamed A'))
    expect(screen.getByTestId('labels')).toHaveTextContent('tab-x=Notes')
    get.mockRestore()
  })

  it('leaves the label alone when the committed name is blank', async () => {
    // An untitled conversation falls back to its assistant name, owned by the page.
    normalTabsValue = [HOME_TAB, chatTab('tab-a', 'Original A', 'topic-a')]
    const get = vi.spyOn(dataApiService, 'get').mockResolvedValue({ id: 'topic-a', name: '' })
    renderShell(<CrossWindowRenameSync />)

    await act(async () => {
      changeListeners.get('/topics/:id')?.([{ endpoint: '/topics/:id', entityIds: ['topic-a'] }])
    })

    await waitFor(() => expect(get).toHaveBeenCalled())
    expect(screen.getByTestId('labels')).toHaveTextContent('tab-a=Original A')
    get.mockRestore()
  })

  it.each([
    { kind: 'Chat', endpoint: '/topics/:id', tab: chatTab('tab-a', 'Old', 'conv-a') },
    { kind: 'Work', endpoint: '/agent-sessions/:sessionId', tab: workTab('tab-a', 'Old', 'conv-a') }
  ])('keeps the newest name when overlapping $kind renames resolve out of order', async ({ endpoint, tab }) => {
    // Rename to X, then another window commits Y: the read-back for X lands last
    // and must not restore the older name over the newer one.
    normalTabsValue = [HOME_TAB, tab]
    const resolvers: Array<(row: unknown) => void> = []
    const get = vi
      .spyOn(dataApiService, 'get')
      .mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)))
    renderShell(<CrossWindowRenameSync />)

    await waitFor(() => expect(screen.getByTestId('labels')).toHaveTextContent('tab-a=Old'))

    await act(async () => {
      changeListeners.get(endpoint)?.([{ endpoint, entityIds: ['conv-a'] }])
      changeListeners.get(endpoint)?.([{ endpoint, entityIds: ['conv-a'] }])
    })
    expect(resolvers).toHaveLength(2)

    await act(async () => resolvers[1]({ id: 'conv-a', name: 'Y' }))
    await act(async () => resolvers[0]({ id: 'conv-a', name: 'X' }))

    await waitFor(() => expect(screen.getByTestId('labels')).toHaveTextContent('tab-a=Y'))
    get.mockRestore()
  })
})
