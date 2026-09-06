// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, render, screen } from '@testing-library/react'
import type { WebviewTag } from 'electron'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { WebviewBrowser } from '../WebviewBrowser'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, type = 'button', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} {...props}>
      {children}
    </button>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/components/WebviewAnnotationControls', () => ({
  WebviewAnnotationControls: ({ target }: { target: { id: string } }) => (
    <div data-testid="annotation-controls" data-target-id={target.id} />
  )
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: () => [false, vi.fn()]
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn().mockResolvedValue(undefined) },
  useIpcOn: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('WebviewBrowser', () => {
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
      getWebContentsId: vi.fn(() => 42),
      loadURL: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn()
    })

    const addressInput = screen.getByRole('textbox', { name: 'webview.navigation.address' })
    expect(addressInput).toBeDisabled()
    expect(addressInput).toHaveClass('text-muted-foreground')
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
})
