// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { mockPreferenceService, mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import { RightPanelProvider, useRightPanelActions, useRightPanelState } from '@renderer/components/chat/panes/Shell'
import type { OpenTabOptions } from '@renderer/hooks/tab'
import type * as TabHooks from '@renderer/hooks/tab'
import en from '@renderer/i18n/locales/en-us.json'
import { AgentBrowserRuntimeService } from '@renderer/services/AgentBrowserRuntimeService'
import { WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

import { SessionBrowserView } from '../SessionBrowserView'

const navigation = vi.hoisted(() => ({ opened: [] as { url: string; options?: OpenTabOptions }[] }))
vi.mock('@renderer/hooks/tab', async (importOriginal) => ({
  ...(await importOriginal<typeof TabHooks>()),
  useOptionalTabsContext: () => ({
    openTab: (url: string, options?: OpenTabOptions) => {
      navigation.opened.push({ url, options })
      return `top-${navigation.opened.length}`
    }
  })
}))

vi.unmock('@cherrystudio/ui')
vi.unmock('react-i18next')
const i18n = createInstance()
const runtime = new AgentBrowserRuntimeService('topic')
const initialApi = window.api
let stripWidth = 900
beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, keySeparator: false })
})
beforeEach(() => {
  mockPreferenceService._resetMockState()
  navigation.opened = []
  vi.stubGlobal('api', initialApi)
  vi.mocked(window.api.ipcApi.request).mockReset().mockResolvedValue({ ok: true, data: undefined })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width: stripWidth } } as ResizeObserverEntry], this)
      }
      unobserve() {}
      disconnect() {}
    }
  )
  stripWidth = 900
  runtime.declare('conversation', 'app-tab')
})
afterEach(() => {
  cleanup()
  runtime.dispose()
  vi.unstubAllGlobals()
})
function SidebarBrowser() {
  const state = useRightPanelState()
  const actions = useRightPanelActions()
  return (
    <>
      <output aria-label="Sidebar state">{state.presentationOpen ? 'open' : 'closed'}</output>
      <SessionBrowserView
        runtime={runtime}
        sessionId="conversation"
        securityProfile={WebviewSecurityProfile.AgentBrowser}
        target={{ id: 'browser', label: 'Browser' }}
        isHostActive
        onEmpty={actions.close}
      />
    </>
  )
}
function setup() {
  render(
    <I18nextProvider i18n={i18n}>
      <RightPanelProvider
        capabilities={[
          {
            component: () => null,
            resolve: () => ({ id: 'browser', instanceKey: 'browser', title: 'Browser', readiness: 'ready' })
          }
        ]}
        scope={null}
        defaultOpen>
        <SidebarBrowser />
      </RightPanelProvider>
    </I18nextProvider>
  )
}
function page(url: string, title: string) {
  const id = runtime.openPage('conversation', url)!
  runtime.update('conversation', { title }, id)
  return id
}

it('keeps the sidebar open with surviving pages and closes it when the last page is deleted with the keyboard', async () => {
  const user = userEvent.setup()
  const first = page('https://example.com/docs', 'Docs')
  page('https://example.com/app', 'Preview')
  setup()
  const docs = screen.getByRole('tab', { name: 'Docs' })
  await user.click(docs)
  await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true')
  await user.keyboard('{Delete}')
  await waitFor(() => expect(docs).toHaveFocus())
  expect(runtime.get('conversation')?.pageId).toBe(first)
  expect(screen.getByLabelText('Sidebar state')).toHaveTextContent('open')
  await user.keyboard('{Delete}')
  await waitFor(() => expect(runtime.getPages('conversation')).toHaveLength(0))
  expect(screen.getByLabelText('Sidebar state')).toHaveTextContent('closed')
})

it.each(['button', 'menu'])('closes the sidebar when its last tab is closed through the %s', async (method) => {
  const user = userEvent.setup()
  page('https://example.com/docs', 'Docs')
  setup()
  if (method === 'button') await user.click(screen.getByRole('button', { name: 'Close Docs' }))
  else {
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Docs' }))
    await user.click(await screen.findByRole('menuitem', { name: /^Close Tab$/ }))
  }
  await waitFor(() => expect(runtime.getPages('conversation')).toHaveLength(0))
  expect(screen.getByLabelText('Sidebar state')).toHaveTextContent('closed')
})

it('selects an overflow entry without changing the running-page identity', async () => {
  stripWidth = 148
  const user = userEvent.setup()
  const docs = page('https://example.com/docs', 'Docs')
  const preview = page('https://example.com/app', 'Preview')
  runtime.update('conversation', { executing: true }, preview)
  runtime.activate('conversation', docs)
  setup()
  await user.click(screen.getByRole('button', { name: 'All tabs' }))
  await user.click(await screen.findByRole('menuitem', { name: /^Preview/ }))
  expect(runtime.get('conversation')?.pageId).toBe(preview)
  act(() => runtime.activate('conversation', docs))
  expect(runtime.get('conversation', preview)?.executing).toBe(true)
  await user.click(screen.getByRole('button', { name: 'View' }))
  expect(runtime.get('conversation')?.pageId).toBe(preview)
  act(() => runtime.closePage('conversation', preview))
  expect(screen.queryByRole('button', { name: 'View' })).not.toBeInTheDocument()
})

// A configured home page must apply to both the first manual page and the tab-strip action.
it('uses the configured home page for manual pages without navigating retained pages', async () => {
  const user = userEvent.setup()
  mockPreferenceState.set('app.browser.start_page.mode', 'custom')
  mockPreferenceState.set('app.browser.start_page.custom_url', 'https://home.test/start')
  setup()
  expect(runtime.get('conversation')?.sourceUrl).toBe('https://home.test/start')
  const first = runtime.get('conversation')!
  mockPreferenceState.set('app.browser.start_page.custom_url', 'https://changed.test/')
  await user.click(screen.getByRole('button', { name: 'New tab' }))
  expect(runtime.getPages('conversation')).toHaveLength(2)
  expect(runtime.get('conversation')?.sourceUrl).toBe('https://changed.test/')
  expect(runtime.get('conversation', first.pageId)?.sourceUrl).toBe('https://home.test/start')
  await user.click(screen.getByRole('button', { name: 'New tab' }))
  expect(runtime.getPages('conversation')).toHaveLength(3)
})

it('shows all pages without an overflow menu when the strip is wide enough', () => {
  page('https://example.com/docs', 'Docs')
  page('https://example.com/app', 'Preview')
  setup()
  expect(screen.getAllByRole('tab')).toHaveLength(2)
  expect(screen.queryByRole('button', { name: 'All tabs' })).not.toBeInTheDocument()
})

// A background tab's menu must never copy or close the selected page by mistake.
it('copies the right-clicked page link without switching the selected page', async () => {
  const user = userEvent.setup()
  const docs = page('https://example.com/docs', 'Docs')
  const preview = page('https://example.com/app', 'Preview')
  setup()
  fireEvent.contextMenu(screen.getByRole('tab', { name: 'Docs' }))
  expect(runtime.get('conversation')?.pageId).toBe(preview)
  expect(screen.queryByRole('menuitem', { name: /reload|refresh/i })).not.toBeInTheDocument()
  await user.click(await screen.findByRole('menuitem', { name: 'Copy link' }))
  await waitFor(async () => expect(await navigator.clipboard.readText()).toBe('https://example.com/docs'))
  expect(runtime.get('conversation')?.pageId).toBe(preview)
  expect(runtime.get('conversation', docs)).toBeDefined()
})

it('closes only pages to the right across overflow and preserves another conversation', async () => {
  const user = userEvent.setup()
  stripWidth = 148
  const docs = page('https://example.com/docs', 'Docs')
  const preview = page('https://example.com/app', 'Preview')
  page('https://example.com/third', 'Third')
  act(() => runtime.activate('conversation', docs))
  runtime.declare('other', 'other-app-tab')
  const other = runtime.openPage('other', 'https://other.test/')
  setup()
  await user.click(screen.getByRole('button', { name: 'All tabs' }))
  fireEvent.contextMenu(await screen.findByRole('menuitem', { name: 'Preview' }))
  expect(runtime.get('conversation')?.pageId).toBe(docs)
  await user.click(await screen.findByRole('menuitem', { name: 'Close Tabs to the Right' }))
  await waitFor(() => expect(runtime.getPages('conversation').map((page) => page.pageId)).toEqual([docs, preview]))
  expect(runtime.get('conversation')?.pageId).toBe(docs)
  expect(runtime.get('other')?.pageId).toBe(other)
})

it('keeps the sidebar open when closing others and closes it when closing all', async () => {
  const user = userEvent.setup()
  const docs = page('https://example.com/docs', 'Docs')
  page('https://example.com/app', 'Preview')
  setup()
  fireEvent.contextMenu(screen.getByRole('tab', { name: 'Docs' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Close Other Tabs' }))
  await waitFor(() => expect(runtime.getPages('conversation')).toHaveLength(1))
  expect(runtime.get('conversation')?.pageId).toBe(docs)
  expect(screen.getByLabelText('Sidebar state')).toHaveTextContent('open')
  fireEvent.contextMenu(screen.getByRole('tab', { name: 'Docs' }))
  expect(await screen.findByRole('menuitem', { name: 'Close Other Tabs' })).toHaveAttribute('data-disabled')
  expect(screen.getByRole('menuitem', { name: 'Close Tabs to the Right' })).toHaveAttribute('data-disabled')
  await user.click(screen.getByRole('menuitem', { name: 'Close all tabs' }))
  await waitFor(() => expect(runtime.getPages('conversation')).toHaveLength(0))
  expect(screen.getByLabelText('Sidebar state')).toHaveTextContent('closed')
})

it.each(['about:blank', 'file:///workspace/preview.html'])(
  'disables opening %s in the external browser',
  async (url) => {
    page(url, 'Local')
    setup()
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Local' }))
    expect(await screen.findByRole('menuitem', { name: 'Open in external browser' })).toHaveAttribute('data-disabled')
  }
)

it('opens the background page in a fresh top-level tab while retaining the sidebar pages', async () => {
  const user = userEvent.setup()
  const url = 'https://example.com/docs?q=a%26b#section'
  page(url, 'Docs')
  const selected = page('https://example.com/app', 'Preview')
  setup()
  fireEvent.contextMenu(screen.getByRole('tab', { name: 'Docs' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Open in new tab' }))
  await waitFor(() =>
    expect(navigation.opened).toEqual([
      { url: `/app/browser?${new URLSearchParams({ url })}`, options: { title: 'Docs', forceNew: true } }
    ])
  )
  expect(runtime.get('conversation')?.pageId).toBe(selected)
  expect(runtime.getPages('conversation')).toHaveLength(2)
})

it.each([
  ['Open in New Window', 'tab.detach'],
  ['Open in external browser', 'system.shell.open_external_website']
])('routes %s to the right-clicked page while retaining its guest', async (label, route) => {
  const user = userEvent.setup()
  const url = 'https://example.com/docs?lang=zh#section'
  const docs = page(url, 'Docs')
  const selected = page('https://example.com/app', 'Preview')
  setup()
  fireEvent.contextMenu(screen.getByRole('tab', { name: 'Docs' }))
  await user.click(await screen.findByRole('menuitem', { name: label }))
  await waitFor(() =>
    expect(window.api.ipcApi.request).toHaveBeenCalledWith(
      route,
      route === 'tab.detach'
        ? expect.objectContaining({
            url: `/app/browser?${new URLSearchParams({ url })}`,
            title: 'Docs',
            type: 'route'
          })
        : url
    )
  )
  expect(runtime.get('conversation')?.pageId).toBe(selected)
  expect(runtime.get('conversation', docs)).toBeDefined()
})

it('closes the background page from its menu while preserving the selected page', async () => {
  const user = userEvent.setup()
  const docs = page('https://example.com/docs', 'Docs')
  const preview = page('https://example.com/app', 'Preview')
  setup()
  fireEvent.contextMenu(screen.getByRole('tab', { name: 'Docs' }))
  await user.click(await screen.findByRole('menuitem', { name: /^Close Tab$/ }))
  await waitFor(() => expect(runtime.get('conversation', docs)).toBeUndefined())
  expect(runtime.get('conversation')?.pageId).toBe(preview)
})
