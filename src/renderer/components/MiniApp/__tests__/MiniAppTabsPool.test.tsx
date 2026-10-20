import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WebviewTag } from 'electron'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TabsProvider } from '@renderer/components/layout/TabsProvider'
import { cacheService } from '@renderer/data/CacheService'
import { createMiniApp } from '@renderer/hooks/__tests__/fixtures/miniApp'
import { useTabs } from '@renderer/hooks/tab'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { useMiniAppRuntime } from '@renderer/hooks/useMiniAppRuntime'
import MiniAppPane from '@renderer/pages/miniApps/components/MiniAppPane'
import { webviewRuntimeService } from '@renderer/services/WebviewRuntimeService'

import MiniAppTabsPool from '../MiniAppTabsPool'

vi.unmock('@renderer/data/hooks/useCache')

const ipc = vi.hoisted(() => ({ request: vi.fn(async () => true), events: new Map<string, (payload: any) => void>() }))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipc.request },
  useIpcOn: (name: string, fn: (payload: any) => void) => {
    ipc.events.set(name, fn)
  }
}))
vi.mock('@renderer/components/AgentBrowserRuntimeHost', () => ({ AgentBrowserRuntimeHost: () => null }))
vi.mock('@renderer/hooks/command', () => ({ useCommandContextKey: () => {} }))
vi.mock('@renderer/pages/miniApps/components/MinimalToolbar', () => ({
  default: ({ isWebviewReady, onReload }: { isWebviewReady: boolean; onReload: () => void }) => (
    <button type="button" disabled={!isWebviewReady} onClick={onReload}>
      Reload guest
    </button>
  )
}))
vi.mock('@renderer/components/WebviewSearch', () => ({ default: () => null }))

const queryGuest = (appId: string) => document.querySelector<WebviewTag>(`webview[data-mini-app-id="${appId}"]`)
const getGuest = (appId: string) => {
  const guest = queryGuest(appId)
  expect(guest).not.toBeNull()
  return guest!
}

function Controls() {
  const tabs = useTabs()
  const [poolVersion, setPoolVersion] = useState(0)
  const popup = useMiniAppPopup()
  const runtime = useMiniAppRuntime()
  return (
    <>
      <button type="button" onClick={() => tabs.openTab('/app/mini-app/a', { id: 'a' })}>
        Open A
      </button>
      <button type="button" onClick={() => tabs.openTab('/app/mini-app/b', { id: 'b' })}>
        Open B
      </button>
      <button type="button" onClick={() => popup.openMiniAppInSplit(createMiniApp('b'))}>
        Split B
      </button>
      <button type="button" onClick={() => tabs.openTab('/app/mini-app/a', { id: 'duplicate', forceNew: true })}>
        Duplicate A
      </button>
      <button type="button" onClick={() => tabs.closeTab('a')}>
        Close A
      </button>
      <button type="button" onClick={() => tabs.closeTab('duplicate')}>
        Close duplicate
      </button>
      <button type="button" onClick={() => tabs.closeTab('b')}>
        Close B
      </button>
      <button type="button" onClick={() => tabs.setActiveTab('home')}>
        Show home
      </button>
      <button type="button" onClick={() => tabs.setActiveTab('a')}>
        Show A
      </button>
      <button type="button" onClick={() => tabs.updateTab('b', { isDormant: true })}>
        Sleep B
      </button>
      <button type="button" onClick={() => tabs.detachTab('a')}>
        Detach A
      </button>
      <output aria-label="dormant">
        {tabs.tabs
          .filter((tab) => tab.isDormant)
          .map((tab) => tab.id)
          .join(',')}
      </output>
      <button type="button" onClick={popup.closeSplit}>
        Collapse split
      </button>
      <output aria-label="tabs">{tabs.tabs.map((tab) => tab.id).join(',')}</output>
      <output aria-label="primary">{tabs.activeTabId}</output>
      <output aria-label="secondary">{runtime.splitMiniAppId}</output>
      <button type="button" onClick={() => setPoolVersion((version) => version + 1)}>
        Remount pool
      </button>
      <MiniAppTabsPool key={poolVersion} />
      <MiniAppPane app={createMiniApp('a')} splitMode="open" onSplit={popup.openSplit} />
    </>
  )
}

beforeEach(() => {
  MockCacheUtils.resetMocks()
  MockUseDataApiUtils.resetMocks()
  MockUsePreferenceUtils.resetMocks()
  MockUseDataApiUtils.mockQueryData('/mini-apps', [createMiniApp('a'), createMiniApp('b')])
  webviewRuntimeService.dispose()
  ipc.events.clear()
  ipc.request.mockReset().mockResolvedValue(true)
})
afterEach(cleanup)
const mount = () =>
  render(
    <TabsProvider>
      <Controls />
    </TabsProvider>
  )

describe('MiniApp guest ownership', () => {
  it('keeps the guest usable while navigation is in progress or aborted', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByText('Open A'))
    const guest = getGuest('a')
    guest.getWebContentsId = () => 42
    guest.reload = vi.fn()
    await act(() => guest.dispatchEvent(new Event('dom-ready')))
    expect(screen.getByRole('button', { name: 'Reload guest' })).toBeEnabled()
    await act(() =>
      guest.dispatchEvent(
        Object.assign(new Event('did-start-navigation'), {
          isMainFrame: true,
          isInPlace: false
        })
      )
    )
    expect(screen.getByRole('button', { name: 'Reload guest' })).toBeEnabled()
    await act(() =>
      guest.dispatchEvent(
        Object.assign(new Event('did-fail-load'), {
          isMainFrame: true,
          errorCode: -3
        })
      )
    )
    await user.click(screen.getByRole('button', { name: 'Reload guest' }))
    expect(guest.reload).toHaveBeenCalledOnce()
    expect(getGuest('a')).toBe(guest)
  })

  it('keeps the new pool guest after the previous pool unmounts', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByText('Open A'))
    await user.click(screen.getByText('Remount pool'))
    const guest = getGuest('a')
    guest.getWebContentsId = () => 42
    await act(() => guest.dispatchEvent(new Event('dom-ready')))
    expect(screen.getByRole('button', { name: 'Reload guest' })).toBeEnabled()
  })

  it('opens split without a tab and releases its guest when collapsed', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByText('Open A'))
    const a = getGuest('a')
    await user.click(screen.getByText('Split B'))
    expect(getGuest('b')).toBeInTheDocument()
    expect(screen.getByLabelText('primary')).toHaveTextContent('a')
    expect(screen.getByLabelText('secondary')).toHaveTextContent('b')
    await user.click(screen.getByText('Collapse split'))
    expect(queryGuest('b')).toBeNull()
    expect(getGuest('a')).toBe(a)
  })

  it('preserves an independently opened tab and guest when split collapses', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByText('Open B'))
    const b = getGuest('b')
    await user.click(screen.getByText('Open A'))
    await user.click(screen.getByText('Split B'))
    expect(screen.getByLabelText('primary')).toHaveTextContent('a')
    expect(getGuest('b')).toBe(b)
    await user.click(screen.getByText('Collapse split'))
    expect(getGuest('b')).toBe(b)
    await user.click(screen.getByText('Close B'))
    expect(queryGuest('b')).toBeNull()
  })

  it('retains a shared guest until the last matching tab closes', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByText('Open A'))
    const guest = getGuest('a')
    await user.click(screen.getByText('Duplicate A'))
    await user.click(screen.getByText('Close A'))
    expect(getGuest('a')).toBe(guest)
    await user.click(screen.getByText('Close duplicate'))
    expect(queryGuest('a')).toBeNull()
  })

  it('removes every matching owner on main-process eviction', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByText('Open A'))
    await user.click(screen.getByText('Duplicate A'))
    act(() => ipc.events.get('mini_app.runtime.evicted')?.({ appId: 'a' }))
    expect(queryGuest('a')).toBeNull()
    expect(screen.getByLabelText('tabs')).not.toHaveTextContent('duplicate')
  })
  it('keeps a guest independent of its dormant route page and restores split presentation', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByText('Open B'))
    await user.click(screen.getByText('Open A'))
    await user.click(screen.getByText('Split B'))
    await user.click(screen.getByText('Show home'))
    expect(screen.getByLabelText('secondary')).toHaveTextContent(/^$/)
    const guest = getGuest('b')
    await user.click(screen.getByText('Sleep B'))
    expect(getGuest('b')).toBe(guest)
    await user.click(screen.getByText('Show A'))
    expect(getGuest('b')).toBeInTheDocument()
    expect(screen.getByLabelText('secondary')).toHaveTextContent('b')
    expect(screen.getByLabelText('dormant')).toHaveTextContent('b')
  })

  it('closes removed catalog apps but preserves transient descriptors absent from the catalog', async () => {
    const user = userEvent.setup()
    const view = mount()
    await user.click(screen.getByText('Open A'))
    MockUseDataApiUtils.mockQueryData('/mini-apps', [createMiniApp('b')])
    view.rerender(
      <TabsProvider>
        <Controls />
      </TabsProvider>
    )
    expect(queryGuest('a')).toBeNull()
    expect(screen.getByLabelText('tabs')).not.toHaveTextContent('a')
    act(() =>
      cacheService.setShared('mini_app.transient_descriptor.a', {
        appId: 'a',
        name: 'Transient',
        url: 'https://a.example'
      })
    )
    await user.click(screen.getByText('Open A'))
    expect(getGuest('a')).toBeInTheDocument()
  })

  it('receives an existing tab without duplicating its owner or guest', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByText('Open A'))
    const guest = getGuest('a')
    await act(async () =>
      ipc.events.get('tab.attached')?.({
        id: 'a',
        type: 'route',
        url: '/app/mini-app/a',
        title: 'A'
      })
    )
    expect(screen.getByLabelText('tabs')).toHaveTextContent('home,a')
    expect(getGuest('a')).toBe(guest)
  })

  it('uses the current tab selection when a pending detach completes', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByText('Open A'))
    let accept!: (value: boolean) => void
    ipc.request.mockReturnValueOnce(
      new Promise((resolve) => {
        accept = resolve
      })
    )
    await user.click(screen.getByText('Detach A'))
    await user.click(screen.getByText('Show home'))
    expect(getGuest('a')).toBeInTheDocument()
    await act(async () => accept(true))
    expect(queryGuest('a')).toBeNull()
    expect(screen.getByLabelText('primary')).toHaveTextContent('home')
  })
  it('does not interpret catalog visibility changes as global tab closure', async () => {
    const user = userEvent.setup()
    const view = mount()
    await user.click(screen.getByText('Open A'))
    const guest = getGuest('a')
    MockUseDataApiUtils.mockQueryData('/mini-apps', [{ ...createMiniApp('a'), status: 'disabled' }, createMiniApp('b')])
    view.rerender(
      <TabsProvider>
        <Controls />
      </TabsProvider>
    )
    expect(getGuest('a')).toBe(guest)
    expect(screen.getByLabelText('tabs')).toHaveTextContent('a')
  })
  it('preserves the source tab and guest when detaching fails', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByText('Open A'))
    const guest = getGuest('a')
    ipc.request.mockRejectedValueOnce(new Error('window creation failed'))
    await user.click(screen.getByText('Detach A'))
    expect(screen.getByLabelText('tabs')).toHaveTextContent('a')
    expect(screen.getByLabelText('primary')).toHaveTextContent('a')
    expect(getGuest('a')).toBe(guest)
  })
})
