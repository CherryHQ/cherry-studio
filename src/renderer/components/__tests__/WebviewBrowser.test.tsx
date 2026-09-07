// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { WebviewTag } from 'electron'
import { Activity } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { WebviewBrowser } from '../WebviewBrowser'

vi.unmock('@cherrystudio/ui')

vi.mock('@renderer/components/WebviewAnnotationControls', () => ({
  WebviewAnnotationControls: ({ target }: { target: { id: string } }) => (
    <div data-testid="annotation-controls" data-target-id={target.id} />
  )
}))

vi.mock('@renderer/data/hooks/usePreference', async () => {
  const { MockUsePreference } = await import('@test-mocks/renderer/usePreference')
  return MockUsePreference
})

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn().mockResolvedValue(undefined) },
  useIpcOn: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('WebviewBrowser', () => {
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

  it('activates navigation and annotations when its isolated guest becomes ready', () => {
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
    expect(screen.getByTestId('annotation-controls')).toHaveAttribute('data-target-id', 'agent-browser:session-a')
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
  it('preserves ordinary cross-origin navigation but replaces the guest across sessions and security modes', () => {
    const target = { id: 'agent-browser:session-a', label: 'Browser' }
    const view = render(
      <WebviewBrowser
        agentSessionId="session-a"
        initialUrl="https://first.test"
        securityProfile="agent-browser"
        isHostActive
        target={target}
      />
    )
    const first = view.container.querySelector('webview')
    expect(first).toHaveAttribute('partition', 'persist:agent-browser')
    expect(first).toHaveAttribute('allowpopups')
    view.rerender(
      <WebviewBrowser
        agentSessionId="session-a"
        initialUrl="http://192.168.1.2"
        securityProfile="agent-browser"
        isHostActive
        target={target}
      />
    )
    expect(view.container.querySelector('webview')).toBe(first)
    view.rerender(
      <WebviewBrowser
        agentSessionId="session-b"
        initialUrl="http://192.168.1.2"
        securityProfile="agent-browser"
        isHostActive
        target={target}
      />
    )
    const second = view.container.querySelector('webview')
    expect(second).not.toBe(first)
    view.rerender(
      <WebviewBrowser
        agentSessionId="session-b"
        initialUrl="http://localhost:5173"
        securityProfile="agent-dev-preview"
        isHostActive
        target={target}
      />
    )
    expect(view.container.querySelector('webview')).not.toBe(second)
    expect(view.container.querySelector('webview')).toHaveAttribute('partition', 'agent-dev-preview')
    expect(view.container.querySelector('webview')).toHaveAttribute('allowpopups')
  })
})
