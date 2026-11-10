// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { mockCacheService, MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { mockPreferenceService, mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WebviewTag } from 'electron'
import type { ComponentProps, ReactNode } from 'react'
import { Activity } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCommandContextKey, useCommandHandler } from '@renderer/hooks/command'
import { ipcApi } from '@renderer/ipc'
import { getDefaultValue } from '@shared/data/preference/preferenceUtils'

import { CommandContextKeyProvider } from '../command/CommandContextKeyProvider'
import { CommandProvider } from '../command/CommandProvider'
import { WebviewBrowser } from '../WebviewBrowser'

vi.unmock('@cherrystudio/ui')

vi.mock('@renderer/data/hooks/usePreference', async () => {
  const { MockUsePreference } = await import('@test-mocks/renderer/usePreference')
  return MockUsePreference
})

vi.mock('@data/hooks/usePreference', async () => {
  const { mockUsePreference } = await import('@test-mocks/renderer/usePreference')
  return {
    usePreference: mockUsePreference,
    useMultiplePreferences: () => [{}, vi.fn()]
  }
})

vi.mock('@renderer/utils/platform', () => ({
  platform: 'darwin',
  isMac: true,
  isWin: false,
  isLinux: false,
  isDev: false,
  isProd: false
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn().mockResolvedValue(undefined) },
  useIpcOn: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('WebviewBrowser', () => {
  describe('standalone start pages', () => {
    const context = 'standalone:persist:agent-browser'
    const remembered = { [context]: 'https://last.test/saved?q=1#section', other: 'https://other.test/' }
    const props = {
      securityProfile: 'agent-browser' as const,
      isHostActive: true,
      target: { id: 'browser:start', label: 'Browser' },
      startPageContext: context
    }
    const open = (overrides: Partial<ComponentProps<typeof WebviewBrowser>> = {}) =>
      render(<WebviewBrowser {...props} {...overrides} />)
    const emit = (guest: Element, name: string, fields: Record<string, unknown>) =>
      act(() => {
        guest.dispatchEvent(Object.assign(new Event(name), fields))
      })

    beforeEach(() => {
      mockPreferenceService._resetMockState()
      mockPreferenceState.set('app.browser.start_page.mode', getDefaultValue('app.browser.start_page.mode'))
      mockPreferenceState.set('app.browser.start_page.custom_url', getDefaultValue('app.browser.start_page.custom_url'))
      MockCacheUtils.setInitialState({ persist: [['ui.browser.last_urls', remembered]] })
    })

    it.each([undefined, 'https://explicit.test/', 'about:blank'])(
      'keeps an unopted caller at %s without accessing start-page memory',
      (initialUrl) => {
        mockPreferenceState.set('app.browser.start_page.mode', 'custom')
        mockPreferenceState.set('app.browser.start_page.custom_url', 'https://custom.test/')
        mockCacheService.getPersist.mockClear()
        mockCacheService.setPersist.mockClear()
        const view = open({ initialUrl, startPageContext: undefined })
        const guest = view.getByTestId('webview-browser-guest')
        expect(guest).toHaveAttribute('src', initialUrl ?? 'about:blank')
        emit(guest, 'did-navigate', { url: 'https://committed.test/' })
        view.rerender(<WebviewBrowser {...props} startPageContext={undefined} />)
        expect(view.getByTestId('webview-browser-guest')).toHaveAttribute('src', 'about:blank')
        expect(mockCacheService.getPersist.mock.calls.filter(([key]) => key === 'ui.browser.last_urls')).toEqual([])
        expect(mockCacheService.setPersist.mock.calls.filter(([key]) => key === 'ui.browser.last_urls')).toEqual([])
        expect(mockCacheService.getPersist('ui.browser.last_urls')).toEqual(remembered)
      }
    )

    it.each([
      ['custom', 'HTTPS://Custom.test:443/start?q=1#part', 'https://custom.test/start?q=1#part'],
      ['custom', '', 'about:blank'],
      ['custom', 'file:///workspace/index.html', 'about:blank'],
      ['custom', 'https://user:pass@custom.test/', 'about:blank'],
      ['last', '', remembered[context]],
      ['blank', 'https://custom.test/', 'about:blank'],
      ['unknown', 'https://custom.test/', 'about:blank'],
      [undefined, 'https://custom.test/', 'about:blank']
    ])('resolves mode %s with custom value %s to %s', (mode, customUrl, expected) => {
      mockPreferenceState.set('app.browser.start_page.mode', mode)
      mockPreferenceState.set('app.browser.start_page.custom_url', customUrl)
      const view = open()
      expect(view.getByTestId('webview-browser-guest')).toHaveAttribute('src', expected)
      expect(mockCacheService.getPersist('ui.browser.last_urls')).toEqual(remembered)
    })

    it.each([undefined, null, [], 'invalid', {}, { [context]: 123 }, { [context]: 'file:///workspace/index.html' }])(
      'opens blank without repairing missing or malformed remembered data: %j',
      (value) => {
        mockPreferenceState.set('app.browser.start_page.mode', 'last')
        MockCacheUtils.setInitialState({ persist: [['ui.browser.last_urls', value]] })
        const original = mockCacheService.getPersist('ui.browser.last_urls')
        mockCacheService.setPersist.mockClear()
        const view = open()
        expect(view.getByTestId('webview-browser-guest')).toHaveAttribute('src', 'about:blank')
        expect(mockCacheService.getPersist('ui.browser.last_urls')).toEqual(original)
        expect(mockCacheService.setPersist.mock.calls.filter(([key]) => key === 'ui.browser.last_urls')).toEqual([])
      }
    )

    it('normalizes only the selected context when restoring its last page', () => {
      mockPreferenceState.set('app.browser.start_page.mode', 'last')
      MockCacheUtils.setInitialState({
        persist: [
          [
            'ui.browser.last_urls',
            { [context]: 'HTTPS://Last.test:443/path?q=1#section', other: 'https://other.test/' }
          ]
        ]
      })
      const view = open()
      expect(view.getByTestId('webview-browser-guest')).toHaveAttribute('src', 'https://last.test/path?q=1#section')
    })

    it.each(['custom', 'last'])(
      'retains the %s snapshot across settings, cache, source and Activity changes',
      (mode) => {
        mockPreferenceState.set('app.browser.start_page.mode', mode)
        mockPreferenceState.set('app.browser.start_page.custom_url', 'https://custom.test/')
        const expected = mode === 'custom' ? 'https://custom.test/' : remembered[context]
        const view = render(
          <Activity mode="visible">
            <WebviewBrowser {...props} />
          </Activity>
        )
        const guest = view.getByTestId('webview-browser-guest')
        expect(guest).toHaveAttribute('src', expected)
        mockPreferenceState.set('app.browser.start_page.mode', 'custom')
        mockPreferenceState.set('app.browser.start_page.custom_url', 'https://changed.test/')
        mockCacheService.setPersist('ui.browser.last_urls', { [context]: 'https://changed-last.test/' })
        view.rerender(
          <Activity mode="hidden">
            <WebviewBrowser {...props} />
          </Activity>
        )
        view.rerender(
          <Activity mode="visible">
            <WebviewBrowser {...props} />
          </Activity>
        )
        expect(view.getByTestId('webview-browser-guest')).toBe(guest)
        expect(guest).toHaveAttribute('src', expected)
        view.rerender(
          <Activity mode="visible">
            <WebviewBrowser {...props} initialUrl="https://explicit.test/" />
          </Activity>
        )
        expect(guest).toHaveAttribute('src', 'https://explicit.test/')
        view.rerender(
          <Activity mode="visible">
            <WebviewBrowser {...props} />
          </Activity>
        )
        expect(guest).toHaveAttribute('src', expected)
      }
    )

    it('remembers commits only while the live mode is last and preserves other contexts', () => {
      mockPreferenceState.set('app.browser.start_page.mode', 'last')
      const view = open()
      const guest = view.getByTestId('webview-browser-guest')
      mockCacheService.setPersist('ui.browser.last_urls', { ...remembered, newer: 'https://newer.test/' })
      emit(guest, 'did-navigate', { url: 'HTTPS://Committed.test:443/path?q=one#first' })
      expect(mockCacheService.getPersist('ui.browser.last_urls')).toEqual({
        ...remembered,
        newer: 'https://newer.test/',
        [context]: 'https://committed.test/path?q=one#first'
      })
      emit(guest, 'did-navigate-in-page', { url: 'http://committed.test/path?q=two#next', isMainFrame: true })
      expect(mockCacheService.getPersist('ui.browser.last_urls')).toEqual({
        ...remembered,
        newer: 'https://newer.test/',
        [context]: 'http://committed.test/path?q=two#next'
      })
      mockPreferenceState.set('app.browser.start_page.mode', 'blank')
      emit(guest, 'did-navigate', { url: 'https://private.test/?token=secret#access_token=secret' })
      emit(guest, 'did-navigate-in-page', { url: 'https://private.test/#secret', isMainFrame: true })
      expect(mockCacheService.getPersist('ui.browser.last_urls')).toEqual({
        ...remembered,
        newer: 'https://newer.test/',
        [context]: 'http://committed.test/path?q=two#next'
      })
    })

    it.each([
      [
        'https://example.test/callback?code=secret-code&access_token=secret-token&q=1#access_token=fragment-secret',
        'https://example.test/callback?q=1'
      ],
      ['https://user:pass@credentials.test/', 'https://credentials.test/']
    ])('sanitizes committed destinations before remembering them: %s', (url, expected) => {
      mockPreferenceState.set('app.browser.start_page.mode', 'last')
      const view = open()
      emit(view.getByTestId('webview-browser-guest'), 'did-navigate', { url })
      expect(mockCacheService.getPersist('ui.browser.last_urls')).toEqual({ ...remembered, [context]: expected })
    })

    it('leaves remembered destinations intact when a committed href exceeds the storage limit', () => {
      mockPreferenceState.set('app.browser.start_page.mode', 'last')
      const view = open()
      emit(view.getByTestId('webview-browser-guest'), 'did-navigate', {
        url: `https://example.test/${'a'.repeat(16_384)}`
      })
      expect(mockCacheService.getPersist('ui.browser.last_urls')).toEqual(remembered)
    })

    it.each(['blank', 'custom', 'unknown', undefined])(
      'does not retain committed HTTP(S) destinations without opting into last mode: %s',
      (mode) => {
        mockPreferenceState.set('app.browser.start_page.mode', mode)
        mockPreferenceState.set('app.browser.start_page.custom_url', 'https://custom.test/')
        const view = open()
        const guest = view.getByTestId('webview-browser-guest')
        mockCacheService.setPersist.mockClear()
        emit(guest, 'did-navigate', { url: 'https://private.test/?token=secret#access_token=secret' })
        emit(guest, 'did-navigate-in-page', { url: 'https://private.test/#secret', isMainFrame: true })
        expect(mockCacheService.getPersist('ui.browser.last_urls')).toEqual(remembered)
        expect(mockCacheService.setPersist.mock.calls.filter(([key]) => key === 'ui.browser.last_urls')).toEqual([])
      }
    )

    it.each([
      ['did-navigate-in-page', { url: 'https://frame.test/', isMainFrame: false }],
      ['did-navigate', { url: 'about:blank' }],
      ['did-navigate', { url: 'file:///workspace/index.html' }],
      ['did-start-navigation', { url: 'https://provisional.test/', isMainFrame: true, isInPlace: false }],
      ['did-fail-load', { validatedURL: 'https://failed.test/', isMainFrame: true, errorCode: -102 }]
    ])('does not replace remembered history for %s %j', (event, fields) => {
      mockPreferenceState.set('app.browser.start_page.mode', 'last')
      const forwarded: string[] = []
      const view = open({ onUrlChange: (url) => forwarded.push(url) })
      emit(view.getByTestId('webview-browser-guest'), event, fields)
      expect(mockCacheService.getPersist('ui.browser.last_urls')).toEqual(remembered)
      expect(forwarded).toEqual(event === 'did-navigate' && 'url' in fields ? [fields.url] : [])
    })

    it.each(['agent-html-artifact', 'agent-dev-preview'] as const)(
      'does not remember HTTP commits emitted by %s',
      (securityProfile) => {
        mockPreferenceState.set('app.browser.start_page.mode', 'last')
        const view = open({
          securityProfile,
          initialUrl:
            securityProfile === 'agent-html-artifact' ? 'file:///workspace/index.html' : 'http://localhost:5173/'
        })
        const guest = view.getByTestId('webview-browser-guest')
        emit(guest, 'did-navigate', { url: 'https://committed.test/' })
        expect(mockCacheService.getPersist('ui.browser.last_urls')).toEqual(remembered)
      }
    )

    it('keeps an unopted artifact isolated after switching to the ordinary browser profile', async () => {
      const user = userEvent.setup()
      const view = open({
        startPageContext: undefined,
        initialUrl: 'file:///workspace/index.html',
        securityProfile: 'agent-html-artifact'
      })
      Object.assign(view.getByTestId('webview-browser-guest'), {
        getWebContentsId: () => 42,
        getURL: () => 'file:///workspace/index.html',
        getTitle: () => 'Artifact',
        canGoBack: () => false,
        canGoForward: () => false
      })
      emit(view.getByTestId('webview-browser-guest'), 'dom-ready', {})
      const address = view.getByRole('textbox', { name: 'webview.navigation.address' })
      await user.clear(address)
      await user.type(address, 'https://ordinary.test/{Enter}')
      const guest = view.getByTestId('webview-browser-guest')
      expect(guest).toHaveAttribute('partition', 'persist:agent-browser')
      expect(guest).toHaveAttribute('src', 'https://ordinary.test/')
      emit(guest, 'did-navigate', { url: 'https://ordinary.test/' })
      expect(mockCacheService.getPersist('ui.browser.last_urls')).toEqual(remembered)
    })

    it.each([undefined, null, [], 'invalid'])(
      'starts a fresh map on an eligible commit when the container is %j',
      (value) => {
        mockPreferenceState.set('app.browser.start_page.mode', 'last')
        MockCacheUtils.setInitialState({ persist: [['ui.browser.last_urls', value]] })
        const view = open()
        emit(view.getByTestId('webview-browser-guest'), 'did-navigate', { url: 'https://committed.test/' })
        expect(mockCacheService.getPersist('ui.browser.last_urls')).toEqual({ [context]: 'https://committed.test/' })
      }
    )
  })

  it('offers annotation only when the host can add it to a conversation', () => {
    const props = {
      initialUrl: 'https://example.com',
      securityProfile: 'agent-browser' as const,
      isHostActive: true,
      target: { id: 'browser-context', label: 'Browser' }
    }
    const view = render(<WebviewBrowser {...props} />)
    expect(screen.queryByRole('button', { name: 'webview.annotation.enable_mode' })).not.toBeInTheDocument()

    view.rerender(<WebviewBrowser {...props} onAnnotationSaved={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'webview.annotation.enable_mode' })).toBeInTheDocument()

    view.rerender(<WebviewBrowser {...props} />)
    expect(screen.queryByRole('button', { name: 'webview.annotation.enable_mode' })).not.toBeInTheDocument()
  })

  it('shows the live title and domain at rest while preserving the full URL during editing', () => {
    const url = 'https://github.com/maizzle/framework'
    const view = render(
      <WebviewBrowser
        initialUrl={url}
        securityProfile="agent-browser"
        isHostActive
        target={{ id: 'browser-title', label: 'Browser' }}
      />
    )
    const guest = view.container.querySelector('webview')!
    Object.assign(guest, {
      getWebContentsId: () => 42,
      getURL: () => url,
      getTitle: () => 'Maizzle framework',
      isLoading: () => false,
      stopFindInPage: () => {},
      canGoBack: () => false,
      canGoForward: () => false
    })
    const emit = (name: string, fields = {}) =>
      act(() => {
        guest.dispatchEvent(Object.assign(new Event(name), fields))
      })
    const address = screen.getByRole('combobox', { name: 'webview.navigation.address' })
    emit('dom-ready')
    expect(guest).toHaveAttribute('allowpopups')
    expect(address).toHaveValue('github.com / Maizzle framework')
    act(() => address.focus())
    expect(address).toHaveValue(url)
    fireEvent.change(address, { target: { value: 'editing a different address' } })
    emit('page-title-updated', { title: 'Pull requests · Maizzle' })
    expect(address).toHaveValue('editing a different address')
    fireEvent.keyDown(address, { key: 'Escape' })
    expect(address).toHaveValue('github.com / Pull requests · Maizzle')
    emit('did-start-navigation', { url: 'https://frame.test', isMainFrame: false, isInPlace: false })
    expect(address).toHaveValue('github.com / Pull requests · Maizzle')
    emit('did-start-navigation', { url: 'https://next.test', isMainFrame: true, isInPlace: false })
    emit('did-navigate', { url: 'https://next.test' })
    expect(address).toHaveValue('next.test')
    emit('page-title-updated', { title: 'Next page' })
    expect(address).toHaveValue('next.test / Next page')
    emit('page-title-updated', { title: '' })
    expect(address).toHaveValue('next.test')
  })

  it.each([
    ['loaded', false],
    ['still loading a subresource', true]
  ])('reports its %s guest hidden while the tab Activity is hidden so main can freeze it', (_label, loading) => {
    const request = vi.mocked(ipcApi.request)
    const browser = (
      <WebviewBrowser
        initialUrl="https://example.com"
        securityProfile="agent-browser"
        isHostActive
        target={{ id: 'browser:tab-a', label: 'Browser' }}
      />
    )
    const view = render(<Activity mode="visible">{browser}</Activity>)
    const guest = view.container.querySelector('webview')!
    Object.assign(guest, {
      getWebContentsId: () => 42,
      isLoading: () => loading,
      getURL: () => 'https://example.com',
      getTitle: () => 'Example',
      canGoBack: () => false,
      canGoForward: () => false
    })
    act(() => {
      guest.dispatchEvent(new Event('dom-ready'))
    })
    const lastVisibility = () => request.mock.calls.findLast(([route]) => route === 'webview.set_visible')?.[1]

    expect(lastVisibility()).toEqual({ webviewId: 42, visible: true })
    view.rerender(<Activity mode="hidden">{browser}</Activity>)
    expect(lastVisibility()).toEqual({ webviewId: 42, visible: false })
    view.rerender(<Activity mode="visible">{browser}</Activity>)
    expect(lastVisibility()).toEqual({ webviewId: 42, visible: true })
  })

  it('restores navigation when Activity resumes an already-loaded native guest', () => {
    const browser = (
      <WebviewBrowser
        initialUrl="https://example.com"
        securityProfile="agent-browser"
        isHostActive
        target={{ id: 'agent-browser:session-a', label: 'Browser' }}
      />
    )
    const view = render(<Activity mode="visible">{browser}</Activity>)
    const guest = view.container.querySelector('webview')!
    Object.assign(guest, {
      getWebContentsId: () => 42,
      isLoading: () => false,
      stopFindInPage: vi.fn(),
      getURL: () => 'https://example.com',
      getTitle: () => 'Example',
      canGoBack: () => false,
      canGoForward: () => false
    })
    act(() => {
      guest.dispatchEvent(new Event('dom-ready'))
    })
    view.rerender(<Activity mode="hidden">{browser}</Activity>)
    view.rerender(<Activity mode="visible">{browser}</Activity>)
    expect(view.container.querySelector('webview')).toBe(guest)
    expect(screen.getByRole('combobox', { name: 'webview.navigation.address' })).toBeEnabled()
  })

  it('activates navigation when its isolated guest becomes ready', () => {
    vi.spyOn(mockRendererLoggerService, 'debug').mockImplementation(() => {})
    const { container } = render(
      <WebviewBrowser
        initialUrl="http://localhost:5173/"
        securityProfile="agent-dev-preview"
        isHostActive
        target={{ id: 'agent-browser:session-a', label: 'Frontend task' }}
        toolbarActions={<button type="button">Pane controls</button>}
      />
    )
    const webview = container.querySelector('webview') as unknown as WebviewTag
    Object.assign(webview, {
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
      getURL: vi.fn(() => 'http://localhost:5173/'),
      getTitle: () => '',
      getWebContentsId: vi.fn(() => 42),
      loadURL: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn()
    })

    const addressInput = screen.getByRole('textbox', { name: 'webview.navigation.address' })
    expect(addressInput).toBeDisabled()
    expect(screen.getByRole('button', { name: 'webview.navigation.back' })).toHaveClass('text-muted-foreground')
    expect(screen.getByRole('status')).toHaveTextContent('webview.browser.loading')

    act(() => {
      webview.dispatchEvent(new Event('dom-ready'))
    })

    expect(screen.getByRole('textbox', { name: 'webview.navigation.address' })).toBeEnabled()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: 'Pane controls' })).toBeInTheDocument()

    act(() => {
      webview.dispatchEvent(
        Object.assign(new Event('did-fail-load'), {
          errorCode: -102,
          errorDescription: 'ERR_CONNECTION_REFUSED',
          isMainFrame: true,
          validatedURL: 'http://localhost:5173/'
        })
      )
    })

    expect(screen.getByRole('alert')).toHaveTextContent('webview.browser.load_failed')
  })

  it('uses generic load-failure copy for an HTML artifact', () => {
    vi.spyOn(mockRendererLoggerService, 'debug').mockImplementation(() => {})
    const { container } = render(
      <WebviewBrowser
        initialUrl="file:///workspace/index.html"
        securityProfile="agent-html-artifact"
        isHostActive
        target={{ id: 'artifact-file:index', label: 'index.html' }}
      />
    )
    const webview = container.querySelector('webview') as unknown as WebviewTag
    Object.assign(webview, {
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
      getURL: vi.fn(() => 'file:///workspace/index.html'),
      getWebContentsId: vi.fn(() => 43),
      loadURL: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn()
    })

    act(() => {
      webview.dispatchEvent(
        Object.assign(new Event('did-fail-load'), {
          errorCode: -6,
          errorDescription: 'ERR_FILE_NOT_FOUND',
          isMainFrame: true,
          validatedURL: 'file:///workspace/index.html'
        })
      )
    })

    expect(screen.getByRole('alert')).toHaveTextContent('webview.navigation.load_failed')
  })

  it('keeps same-origin dev navigation in one guest but replaces it before authorizing a new origin', () => {
    vi.spyOn(mockRendererLoggerService, 'debug').mockImplementation(() => {})
    const target = { id: 'agent-browser:session-a', label: 'Frontend task' }
    const view = render(
      <WebviewBrowser
        initialUrl="http://localhost:5173/"
        securityProfile="agent-dev-preview"
        isHostActive
        target={target}
      />
    )
    const firstGuest = view.container.querySelector('webview')

    view.rerender(
      <WebviewBrowser
        initialUrl="http://localhost:5173/dashboard"
        securityProfile="agent-dev-preview"
        isHostActive
        target={target}
      />
    )
    expect(view.container.querySelector('webview')).toBe(firstGuest)

    view.rerender(
      <WebviewBrowser
        initialUrl="http://localhost:4173/"
        securityProfile="agent-dev-preview"
        isHostActive
        target={target}
      />
    )
    expect(view.container.querySelector('webview')).not.toBe(firstGuest)
  })

  it('replaces an artifact guest when the authorized file changes', () => {
    vi.spyOn(mockRendererLoggerService, 'debug').mockImplementation(() => {})
    const target = { id: 'artifact-file:index', label: 'index.html' }
    const view = render(
      <WebviewBrowser
        initialUrl="file:///workspace/index.html"
        securityProfile="agent-html-artifact"
        isHostActive
        target={target}
      />
    )
    const firstGuest = view.container.querySelector('webview')

    view.rerender(
      <WebviewBrowser
        initialUrl="file:///workspace/about.html"
        securityProfile="agent-html-artifact"
        isHostActive
        target={target}
      />
    )

    expect(view.container.querySelector('webview')).not.toBe(firstGuest)
  })

  it('does not run host tab history for a focused guest when another host later clears focus', () => {
    goBack.mockClear()
    const view = render(
      <HistoryHarness otherFocused={false}>
        <WebviewBrowser
          initialUrl="https://example.com"
          securityProfile="agent-browser"
          isHostActive
          target={{ id: 'browser-history', label: 'Browser' }}
        />
      </HistoryHarness>
    )
    const guest = view.container.querySelector('webview')!

    pressHistoryBack()
    expect(goBack).toHaveBeenCalledOnce()

    act(() => {
      guest.dispatchEvent(new Event('focus'))
    })
    pressHistoryBack()
    expect(goBack).toHaveBeenCalledOnce()

    view.rerender(
      <HistoryHarness otherFocused>
        <WebviewBrowser
          initialUrl="https://example.com"
          securityProfile="agent-browser"
          isHostActive
          target={{ id: 'browser-history', label: 'Browser' }}
        />
      </HistoryHarness>
    )
    view.rerender(
      <HistoryHarness otherFocused={false}>
        <WebviewBrowser
          initialUrl="https://example.com"
          securityProfile="agent-browser"
          isHostActive
          target={{ id: 'browser-history', label: 'Browser' }}
        />
      </HistoryHarness>
    )
    pressHistoryBack()
    expect(goBack).toHaveBeenCalledOnce()

    act(() => {
      guest.dispatchEvent(new Event('blur'))
    })
    pressHistoryBack()
    expect(goBack).toHaveBeenCalledTimes(2)

    act(() => {
      guest.dispatchEvent(new Event('focus'))
    })
    view.rerender(
      <HistoryHarness otherFocused={false}>
        <WebviewBrowser
          initialUrl="https://example.com"
          securityProfile="agent-browser"
          isHostActive={false}
          target={{ id: 'browser-history', label: 'Browser' }}
        />
      </HistoryHarness>
    )
    pressHistoryBack()
    expect(goBack).toHaveBeenCalledTimes(3)
  })
})

const goBack = vi.fn()

function HistoryHarness({ otherFocused, children }: { otherFocused: boolean; children: ReactNode }) {
  return (
    <CommandContextKeyProvider>
      <CommandProvider>
        <OtherGuestFocus focused={otherFocused} />
        <HistoryBack />
        {children}
      </CommandProvider>
    </CommandContextKeyProvider>
  )
}

function OtherGuestFocus({ focused }: { focused: boolean }) {
  useCommandContextKey('webview.focused', focused)
  return null
}

function HistoryBack() {
  useCommandHandler('tab.history.back', goBack)
  return null
}

function pressHistoryBack() {
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: '[',
      code: 'BracketLeft',
      metaKey: true,
      cancelable: true
    })
  )
}
