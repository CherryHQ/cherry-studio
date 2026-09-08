// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { TabIdProvider } from '@renderer/components/layout/TabIdProvider'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WebviewTag } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BrowserPage } from '../BrowserPage'

vi.unmock('@cherrystudio/ui')
const tabs = vi.hoisted(() => ({
  activeTabId: 'browser-tab',
  tabs: [{ id: 'browser-tab', type: 'route', url: '/app/browser?url=https://first.test', title: 'Old title' }],
  updateTab: vi.fn()
}))
vi.mock('@renderer/hooks/tab/useTabsContext', () => ({ useOptionalTabsContext: () => tabs }))

beforeEach(() => vi.clearAllMocks())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn().mockResolvedValue(undefined) }, useIpcOn: vi.fn() }))

function openBrowser(href: string) {
  const root = createRootRoute()
  const route = createRoute({
    getParentRoute: () => root,
    path: '/app/browser',
    validateSearch: (search): { url: string } => ({ url: String(search.url) }),
    component: () => (
      <TabIdProvider tabId="browser-tab">
        <BrowserPage initialUrl={route.useSearch().url} />
      </TabIdProvider>
    )
  })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [href] })
  })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('Browser tab restoration', () => {
  it('restores committed navigation after unmount without reloading the guest during route synchronization', async () => {
    const first = 'https://example.com/start'
    const view = openBrowser(`/app/browser?url=${encodeURIComponent(first)}`)
    const guest = (await screen.findByTestId('webview-browser-guest')) as unknown as WebviewTag
    let currentUrl = first
    Object.assign(guest, {
      getURL: () => currentUrl,
      getTitle: () => 'Example',
      getWebContentsId: () => 42,
      isLoading: () => false,
      canGoBack: () => false,
      canGoForward: () => false,
      stopFindInPage: vi.fn()
    })
    act(() => {
      guest.dispatchEvent(new Event('dom-ready'))
    })
    const setAttribute = vi.spyOn(guest, 'setAttribute')
    const emit = (name: string, url: string, fields = {}) => {
      act(() => {
        guest.dispatchEvent(Object.assign(new Event(name), { url, ...fields }))
      })
    }

    currentUrl = 'https://example.com/redirected?q=a%20b'
    emit('did-navigate', currentUrl)
    await waitFor(() => expect(view.router.state.location.search).toEqual({ url: currentUrl }))
    currentUrl = 'https://example.com/redirected?q=a%20b#/details'
    emit('did-navigate-in-page', currentUrl, { isMainFrame: true })
    await waitFor(() => expect(view.router.state.location.search).toEqual({ url: currentUrl }))
    emit('did-navigate-in-page', 'https://frame.test/', { isMainFrame: false })
    expect(view.router.state.location.search).toEqual({ url: currentUrl })
    expect(setAttribute.mock.calls.filter(([name]) => name === 'src')).toEqual([])

    const savedRoute = view.router.state.location.href
    view.unmount()
    openBrowser(savedRoute)
    expect(await screen.findByTestId('webview-browser-guest')).toHaveAttribute('src', currentUrl)
  })
})

describe('Browser tab metadata', () => {
  it('follows page titles and favicons across navigation without retaining the previous website icon', async () => {
    const view = openBrowser('/app/browser?url=https://first.test')
    const guest = await view.findByTestId('webview-browser-guest')
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

it('opens a typed local HTML URL in a new artifact guest and persists the route', async () => {
  const view = openBrowser('/app/browser?url=https://first.test')
  const oldGuest = await screen.findByTestId('webview-browser-guest')
  const address = screen.getByRole('combobox')
  fireEvent.focus(address)
  fireEvent.change(address, { target: { value: 'file:///tmp/local%20page.html' } })
  fireEvent.submit(address.closest('form')!)
  await waitFor(() => expect(view.router.state.location.search).toEqual({ url: 'file:///tmp/local%20page.html' }))
  const guest = screen.getByTestId('webview-browser-guest')
  expect(guest).not.toBe(oldGuest)
  expect(guest).toHaveAttribute('partition', 'agent-html-artifact')
  expect(guest).toHaveAttribute('src', 'file:///tmp/local%20page.html')
})
