// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Activity, StrictMode, useState } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { TabIdProvider } from '@renderer/components/layout/TabIdProvider'
import { TabsProvider } from '@renderer/components/layout/TabsProvider'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useAgentTabIconChangeSync } from '@renderer/hooks/agent/useAgentTabIconChangeSync'
import { useTabSelfVisuals, useTabsContext } from '@renderer/hooks/tab'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

vi.unmock('@renderer/data/hooks/useDataApi')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() }, useIpcOn: vi.fn() }))
vi.mock('@renderer/hooks/useWindowInitData', () => ({ useWindowInitData: () => null }))

const HOME: Tab = { id: 'home', type: 'route', url: '/app/chat', title: 'Chat' }
const work = (id: string, sessionId = id): Tab => ({
  id,
  type: 'route',
  url: `/app/agents?sessionId=${sessionId}`,
  title: `Title ${id}`,
  icon: 'emoji:🐱'
})

function Sync() {
  useAgentTabIconChangeSync()
  return null
}

function PageWriter() {
  const { agent } = useAgent('agent')
  useTabSelfVisuals({ title: 'Title a', emoji: agent?.configuration?.avatar, routePrefix: '/app/agents' })
  return <output aria-label="Page agent">{`${agent?.name}|${agent?.configuration?.avatar}`}</output>
}

function Shell({ page = false }: { page?: boolean }) {
  const { tabs, activeTabId, updateTab, closeTab } = useTabsContext()
  const [sync, setSync] = useState(true)
  const [visible, setVisible] = useState(true)
  return (
    <>
      {sync && <Sync />}
      {page && (
        <Activity mode={visible ? 'visible' : 'hidden'}>
          <TabIdProvider tabId="a">
            <PageWriter />
          </TabIdProvider>
        </Activity>
      )}
      <output aria-label="Active tab">{activeTabId}</output>
      {tabs.map((tab) => (
        <output key={tab.id} aria-label={tab.id}>
          {`${tab.title}|${tab.icon ?? 'default'}|${tab.isDormant ? 'dormant' : 'awake'}|${tab.isPinned ? 'pinned' : 'normal'}`}
        </output>
      ))}
      <button type="button" onClick={() => updateTab('a', { url: '/app/agents?sessionId=other' })}>
        Navigate
      </button>
      <button type="button" onClick={() => closeTab('b')}>
        Close
      </button>
      <button type="button" onClick={() => setSync(false)}>
        Stop sync
      </button>
      <button type="button" onClick={() => setVisible((value) => !value)}>
        Toggle page
      </button>
    </>
  )
}

function mount(normal: Tab[], pinned: Tab[] = [], page = false) {
  MockUseCacheUtils.setPersistCacheValue('ui.tab.normal_tabs', [HOME, ...normal])
  MockUseCacheUtils.setPersistCacheValue('ui.tab.pinned_tabs', pinned)
  // Keep provider request ordering intact while StrictMode replays the hook effects.
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <StrictMode>
        <TabsProvider initialDefaultTab={HOME}>
          <Shell page={page} />
        </TabsProvider>
      </StrictMode>
    </SWRConfig>
  )
}

async function changed(agentId = 'agent') {
  await act(async () => MockDataApiUtils.emitDataChange([{ endpoint: '/agents/:agentId', entityIds: [agentId] }]))
}

beforeEach(() => {
  MockUseCacheUtils.resetMocks()
  MockDataApiUtils.resetMocks()
  MockUseCacheUtils.setPersistCacheValue('ui.tab.active_tab_id', 'home')
})
afterEach(cleanup)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useAgentTabIconChangeSync', () => {
  it('keeps the committed avatar when a hidden page resumes with its cached agent', async () => {
    const user = userEvent.setup()
    let avatar = '🐱'
    vi.mocked(dataApiService.get).mockImplementation(
      async (path) =>
        (path.startsWith('/agent-sessions/')
          ? { agentId: 'agent' }
          : { id: 'agent', name: 'Agent name', configuration: { avatar } }) as never
    )
    mount([work('a')], [], true)
    await waitFor(() => expect(screen.getByLabelText('Page agent')).toHaveTextContent('Agent name|🐱'))
    await user.click(screen.getByRole('button', { name: 'Toggle page' }))
    avatar = '🐶'
    await changed()
    expect(screen.getByLabelText('a')).toHaveTextContent('emoji:🐶')
    await user.click(screen.getByRole('button', { name: 'Toggle page' }))
    await waitFor(() => expect(screen.getByLabelText('a')).toHaveTextContent('emoji:🐶'))
    expect(screen.getByLabelText('Page agent')).toHaveTextContent('Agent name|🐶')
  })

  it('does not let an older SWR request overwrite the committed agent after cache publication', async () => {
    const user = userEvent.setup()
    const pending = deferred<{ id: string; name: string; configuration: { avatar: string } }>()
    const started = deferred<void>()
    let initial = true
    vi.mocked(dataApiService.get).mockImplementation(async (path) => {
      if (path.startsWith('/agent-sessions/')) return { agentId: 'agent' } as never
      if (initial) {
        started.resolve()
        return pending.promise as never
      }
      return { id: 'agent', name: 'New name', configuration: { avatar: '🐶' } } as never
    })
    mount([work('a')], [], true)
    await act(async () => started.promise)
    await user.click(screen.getByRole('button', { name: 'Toggle page' }))
    initial = false
    await changed()
    await user.click(screen.getByRole('button', { name: 'Toggle page' }))
    await act(async () => pending.resolve({ id: 'agent', name: 'Old name', configuration: { avatar: '🐱' } }))
    expect(screen.getByLabelText('Page agent')).toHaveTextContent('New name|🐶')
    expect(screen.getByLabelText('a')).toHaveTextContent('emoji:🐶')
  })
  it('refreshes dormant and pinned Work icons without waking tabs or changing titles and other routes', async () => {
    // Hidden pages cannot run their visual writer after an avatar edit in another tab/window.
    vi.mocked(dataApiService.get).mockImplementation(async (path) => {
      if (path.startsWith('/agent-sessions/')) return { agentId: 'agent' } as never
      return { configuration: { avatar: '🐶' } } as never
    })
    mount(
      [
        work('a'),
        work('duplicate', 'a'),
        { ...work('stray'), url: '/app/notes?sessionId=a' },
        { ...work('web'), type: 'webview' },
        { ...work('landing'), url: '/app/agents' }
      ],
      [{ ...work('pin', 'b'), isPinned: true }]
    )
    await changed()
    for (const id of ['a', 'duplicate', 'pin']) {
      await waitFor(() => expect(screen.getByLabelText(id)).toHaveTextContent(`Title ${id}|emoji:🐶|dormant`))
    }
    expect(screen.getByLabelText('pin')).toHaveTextContent('pinned')
    for (const id of ['stray', 'web', 'landing']) expect(screen.getByLabelText(id)).toHaveTextContent('emoji:🐱')
    expect(screen.getByLabelText('Active tab')).toHaveTextContent('home')
  })

  it('replaces emoji with image avatars and removes the icon when the avatar is cleared', async () => {
    let avatar: string | undefined = 'https://example.com/avatar.png'
    vi.mocked(dataApiService.get).mockImplementation(
      async (path) =>
        (path.startsWith('/agent-sessions/') ? { agentId: 'agent' } : { configuration: { avatar } }) as never
    )
    mount([work('a')])
    await changed()
    expect(screen.getByLabelText('a')).toHaveTextContent('Title a|https://example.com/avatar.png|dormant')
    avatar = ''
    await changed()
    expect(screen.getByLabelText('a')).toHaveTextContent('Title a|default|dormant')
    avatar = '🐶'
    await changed()
    expect(screen.getByLabelText('a')).toHaveTextContent('Title a|emoji:🐶|dormant')
    avatar = undefined
    await changed()
    expect(screen.getByLabelText('a')).toHaveTextContent('Title a|default|dormant')
  })

  it('discards delayed icons after navigation, tab closure, and sync unmount', async () => {
    const user = userEvent.setup()
    const pending = deferred<{ configuration: { avatar: string } }>()
    vi.mocked(dataApiService.get).mockImplementation(
      async (path) => (path.startsWith('/agent-sessions/') ? { agentId: 'agent' } : pending.promise) as never
    )
    mount([work('a'), work('b'), work('c')])
    await changed()
    await user.click(screen.getByRole('button', { name: 'Navigate' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await act(async () => pending.resolve({ configuration: { avatar: '🐶' } }))
    expect(screen.getByLabelText('a')).toHaveTextContent('emoji:🐱')
    expect(screen.queryByLabelText('b')).not.toBeInTheDocument()
    expect(screen.getByLabelText('c')).toHaveTextContent('emoji:🐶')

    const afterUnmount = deferred<{ configuration: { avatar: string } }>()
    vi.mocked(dataApiService.get).mockImplementation(
      async (path) => (path.startsWith('/agent-sessions/') ? { agentId: 'agent' } : afterUnmount.promise) as never
    )
    await changed()
    await user.click(screen.getByRole('button', { name: 'Stop sync' }))
    await act(async () => afterUnmount.resolve({ configuration: { avatar: '🐸' } }))
    expect(screen.getByLabelText('a')).toHaveTextContent('emoji:🐱')
    expect(screen.getByLabelText('c')).toHaveTextContent('emoji:🐶')
  })

  it('retains both agents newest icons when different-agent edit batches resolve out of order', async () => {
    const user = userEvent.setup()
    const older = deferred<{ name: string; configuration: { avatar: string } }>()
    let initial = true
    let latest = false
    vi.mocked(dataApiService.get).mockImplementation(async (path) => {
      if (path.startsWith('/agent-sessions/')) return { agentId: path.endsWith('/a') ? 'agent' : 'two' } as never
      if (initial) return { id: 'agent', name: 'Initial name', configuration: { avatar: '🐱' } } as never
      if (!latest) return older.promise as never
      return { name: 'Latest name', configuration: { avatar: path.endsWith('/agent') ? '🐶' : '🐸' } } as never
    })
    mount([work('a'), work('b')], [], true)
    await waitFor(() => expect(screen.getByLabelText('Page agent')).toHaveTextContent('Initial name|🐱'))
    await user.click(screen.getByRole('button', { name: 'Toggle page' }))
    initial = false
    await changed('agent')
    latest = true
    await changed('two')
    expect(screen.getByLabelText('a')).toHaveTextContent('emoji:🐶')
    expect(screen.getByLabelText('b')).toHaveTextContent('emoji:🐸')
    await act(async () => older.resolve({ name: 'Old name', configuration: { avatar: '🐱' } }))
    await user.click(screen.getByRole('button', { name: 'Toggle page' }))
    expect(screen.getByLabelText('Page agent')).toHaveTextContent('Latest name|🐶')
    expect(screen.getByLabelText('a')).toHaveTextContent('emoji:🐶')
    expect(screen.getByLabelText('b')).toHaveTextContent('emoji:🐸')
  })

  it('updates valid tabs when another session or agent disappeared and leaves orphaned sessions alone', async () => {
    vi.mocked(dataApiService.get).mockImplementation(async (path) => {
      if (path === '/agent-sessions/missing' || path === '/agents/deleted') throw new Error('Not found')
      if (path === '/agent-sessions/orphan') return { agentId: null } as never
      if (path.startsWith('/agent-sessions/'))
        return { agentId: path.endsWith('/deleted') ? 'deleted' : 'agent' } as never
      return { configuration: { avatar: '🐶' } } as never
    })
    mount([work('a'), work('missing'), work('deleted'), work('orphan')])
    await changed()
    expect(screen.getByLabelText('a')).toHaveTextContent('emoji:🐶')
    for (const id of ['missing', 'deleted', 'orphan']) expect(screen.getByLabelText(id)).toHaveTextContent('emoji:🐱')
  })
})
