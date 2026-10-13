import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WebviewTag } from 'electron'
import { useCallback } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TabsProvider } from '@renderer/components/layout/TabsProvider'
import { cacheService } from '@renderer/data/CacheService'
import { createMiniApp } from '@renderer/hooks/__tests__/fixtures/miniApp'
import { useTabs } from '@renderer/hooks/tab'
import { miniAppWebviewService } from '@renderer/services/MiniAppWebviewService'
import { canPresentMiniAppSplit } from '@renderer/utils/miniAppKeepAlive'

import MiniAppTabsPool from '../MiniAppTabsPool'

const ipc = vi.hoisted(() => ({ request: vi.fn(async () => true), events: new Map<string, (payload: any) => void>() }))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipc.request },
  useIpcOn: (name: string, fn: (payload: any) => void) => {
    ipc.events.set(name, fn)
  }
}))
vi.mock('@renderer/components/AgentBrowserRuntimeHost', () => ({ AgentBrowserRuntimeHost: () => null }))
vi.mock('@renderer/hooks/command', () => ({ useCommandContextKey: () => {} }))
vi.mock('../WebviewContainer', () => ({
  default: function Guest({
    appid,
    onSetRefCallback
  }: {
    appid: string
    onSetRefCallback: (id: string, el: WebviewTag | null) => void
  }) {
    const bind = useCallback(
      (el: HTMLDivElement | null) => onSetRefCallback(appid, el as unknown as WebviewTag | null),
      [appid, onSetRefCallback]
    )
    return <div ref={bind} data-testid={`guest-${appid}`} />
  }
}))

function Controls() {
  const tabs = useTabs()
  return (
    <>
      <button type="button" onClick={() => tabs.openTab('/app/mini-app/a', { id: 'a' })}>
        Open A
      </button>
      <button type="button" onClick={() => tabs.openTab('/app/mini-app/b', { id: 'b', placement: 'secondary' })}>
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
      <button type="button" onClick={tabs.closeSecondaryPane}>
        Collapse split
      </button>
      <output aria-label="tabs">{tabs.tabs.map((tab) => tab.id).join(',')}</output>
      <output aria-label="primary">{tabs.activeTabId}</output>
      <output aria-label="secondary">{tabs.secondaryPane?.tabId ?? ''}</output>
      <MiniAppTabsPool />
    </>
  )
}

beforeEach(() => {
  MockUseCacheUtils.resetMocks()
  MockUseDataApiUtils.resetMocks()
  MockUsePreferenceUtils.resetMocks()
  MockUseDataApiUtils.mockQueryData('/mini-apps', [createMiniApp('a'), createMiniApp('b')])
  miniAppWebviewService.dispose()
  ipc.events.clear()
  ipc.request.mockReset().mockResolvedValue(true)
})
afterEach(cleanup)
const mount = () =>
  render(
    <TabsProvider canPresentSecondary={canPresentMiniAppSplit}>
      <Controls />
    </TabsProvider>
  )

describe('Tab-owned MiniApp guests', () => {
  it('keeps the split tab reachable after collapsing and releases its guest when closed', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByText('Open A'))
    const a = screen.getByTestId('guest-a')
    await user.click(screen.getByText('Split B'))
    const b = screen.getByTestId('guest-b')
    expect(screen.getByLabelText('primary')).toHaveTextContent('a')
    expect(screen.getByLabelText('secondary')).toHaveTextContent('b')
    await user.click(screen.getByText('Collapse split'))
    expect(screen.getByLabelText('tabs')).toHaveTextContent('b')
    expect(screen.getByTestId('guest-b')).toBe(b)
    await user.click(screen.getByText('Close B'))
    expect(screen.queryByTestId('guest-b')).toBeNull()
    expect(screen.getByTestId('guest-a')).toBe(a)
  })

  it('retains a shared guest until the last matching tab closes', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByText('Open A'))
    const guest = screen.getByTestId('guest-a')
    await user.click(screen.getByText('Duplicate A'))
    await user.click(screen.getByText('Close A'))
    expect(screen.getByTestId('guest-a')).toBe(guest)
    await user.click(screen.getByText('Close duplicate'))
    expect(screen.queryByTestId('guest-a')).toBeNull()
  })

  it('removes every matching owner on main-process eviction', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByText('Open A'))
    await user.click(screen.getByText('Duplicate A'))
    act(() => ipc.events.get('mini_app.runtime.evicted')?.({ appId: 'a' }))
    expect(screen.queryByTestId('guest-a')).toBeNull()
    expect(screen.getByLabelText('tabs')).not.toHaveTextContent('duplicate')
  })
  it('restores the latent split and wakes its dormant tab when returning from another page', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByText('Open A'))
    await user.click(screen.getByText('Split B'))
    await user.click(screen.getByText('Show home'))
    expect(screen.getByLabelText('secondary')).toHaveTextContent(/^$/)
    await user.click(screen.getByText('Sleep B'))
    expect(screen.queryByTestId('guest-b')).toBeNull()
    await user.click(screen.getByText('Show A'))
    expect(screen.getByTestId('guest-b')).toBeInTheDocument()
    expect(screen.getByLabelText('secondary')).toHaveTextContent('b')
    expect(screen.getByLabelText('dormant')).not.toHaveTextContent('b')
  })

  it('closes removed catalog apps but preserves transient descriptors absent from the catalog', async () => {
    const user = userEvent.setup()
    const view = mount()
    await user.click(screen.getByText('Open A'))
    MockUseDataApiUtils.mockQueryData('/mini-apps', [createMiniApp('b')])
    view.rerender(
      <TabsProvider canPresentSecondary={canPresentMiniAppSplit}>
        <Controls />
      </TabsProvider>
    )
    expect(screen.queryByTestId('guest-a')).toBeNull()
    expect(screen.getByLabelText('tabs')).not.toHaveTextContent('a')
    act(() =>
      cacheService.setShared('mini_app.transient_descriptor.a', {
        appId: 'a',
        name: 'Transient',
        url: 'https://a.example'
      })
    )
    await user.click(screen.getByText('Open A'))
    expect(screen.getByTestId('guest-a')).toBeInTheDocument()
  })

  it('acknowledges an existing tab without creating another owner', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByText('Open A'))
    const guest = screen.getByTestId('guest-a')
    await act(async () =>
      ipc.events.get('tab.attached')?.({
        id: 'a',
        type: 'route',
        url: '/app/mini-app/a',
        title: 'A',
        transferId: 'receipt'
      })
    )
    expect(ipc.request).toHaveBeenCalledWith('tab.received', { transferId: 'receipt', tabId: 'a' })
    expect(screen.getByLabelText('tabs')).toHaveTextContent('home,a')
    expect(screen.getByTestId('guest-a')).toBe(guest)
  })

  it('rolls back a newly received tab whose transfer expired', async () => {
    mount()
    ipc.request.mockResolvedValue(false)
    await act(async () =>
      ipc.events.get('tab.attached')?.({
        id: 'a',
        type: 'route',
        url: '/app/mini-app/a',
        title: 'A',
        transferId: 'expired'
      })
    )
    expect(screen.queryByTestId('guest-a')).toBeNull()
    expect(screen.getByLabelText('tabs')).toHaveTextContent('home')
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
    expect(screen.getByTestId('guest-a')).toBeInTheDocument()
    await act(async () => accept(true))
    expect(screen.queryByTestId('guest-a')).toBeNull()
    expect(screen.getByLabelText('primary')).toHaveTextContent('home')
  })
  it('does not interpret catalog visibility changes as global tab closure', async () => {
    const user = userEvent.setup()
    const view = mount()
    await user.click(screen.getByText('Open A'))
    const guest = screen.getByTestId('guest-a')
    MockUseDataApiUtils.mockQueryData('/mini-apps', [{ ...createMiniApp('a'), status: 'disabled' }, createMiniApp('b')])
    view.rerender(
      <TabsProvider canPresentSecondary={canPresentMiniAppSplit}>
        <Controls />
      </TabsProvider>
    )
    expect(screen.getByTestId('guest-a')).toBe(guest)
    expect(screen.getByLabelText('tabs')).toHaveTextContent('a')
  })
})
