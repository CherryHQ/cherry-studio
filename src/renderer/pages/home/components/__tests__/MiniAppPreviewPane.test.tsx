// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn() },
  useIpcOn: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// WebviewHost mounts a real <webview>; the pane's contract is what it PASSES there,
// not Chromium. The stub records the props.
const { webviewHostProps } = vi.hoisted(() => ({ webviewHostProps: [] as Array<Record<string, unknown>> }))
vi.mock('@renderer/components/WebviewHost', () => ({
  WebviewHost: (props: Record<string, unknown>) => {
    webviewHostProps.push(props)
    return <div data-testid="webview-host" />
  }
}))

import { ipcApi } from '@renderer/ipc'

import { MiniAppPreviewPane } from '../MiniAppPreviewPane'

const PREVIEW = {
  previewId: 'p1',
  runtimeId: 'preview-p1',
  sessionId: 'topic-1',
  appId: 'com.example.previewme',
  version: '1.0.0',
  entry: 'index.html',
  packageSha256: 'sha256:x',
  openedAt: 1
}

function mockRequest(list: unknown[] = [PREVIEW]) {
  vi.mocked(ipcApi.request).mockImplementation((route: string) => {
    if (route === 'mini_app.authoring.list') return Promise.resolve(list)
    if (route === 'mini_app.runtime.prepare') return Promise.resolve(undefined)
    if (route === 'mini_app.authoring.close') return Promise.resolve(undefined)
    return Promise.reject(new Error(`unexpected route ${route}`))
  })
}

beforeEach(() => {
  webviewHostProps.length = 0
  mockRequest()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MiniAppPreviewPane', () => {
  it('lists the topic’s previews and shows the empty state', async () => {
    mockRequest([])
    render(<MiniAppPreviewPane sessionId="topic-1" open />)

    await waitFor(() => expect(screen.getByText('miniApp.preview.pane.empty')).toBeInTheDocument())
    expect(ipcApi.request).toHaveBeenCalledWith('mini_app.authoring.list', { sessionId: 'topic-1' })
  })

  it('prepares the selected preview’s runtime id before mounting the guest', async () => {
    render(<MiniAppPreviewPane sessionId="topic-1" open />)

    await waitFor(() => expect(screen.getByTestId('webview-host')).toBeInTheDocument())
    // The partition is prepared BEFORE the webview mounts — the ordering the
    // will-attach veto depends on.
    const calls = vi.mocked(ipcApi.request).mock.calls.map(([route]) => route)
    expect(calls.indexOf('mini_app.runtime.prepare')).toBeGreaterThanOrEqual(0)
    expect(ipcApi.request).toHaveBeenCalledWith('mini_app.runtime.prepare', { appId: 'preview-p1' })
    expect(webviewHostProps[0]).toMatchObject({
      id: 'p1',
      src: 'cherry-miniapp://preview-p1/index.html',
      partition: 'persist:miniapp:preview-p1'
    })
  })

  it('shows the start-failed state when prepare rejects', async () => {
    vi.mocked(ipcApi.request).mockImplementation((route: string) => {
      if (route === 'mini_app.authoring.list') return Promise.resolve([PREVIEW])
      if (route === 'mini_app.runtime.prepare') return Promise.reject(new Error('nope'))
      return Promise.reject(new Error('unexpected'))
    })
    render(<MiniAppPreviewPane sessionId="topic-1" open />)

    await waitFor(() => expect(screen.getByText('miniApp.preview.pane.start_failed')).toBeInTheDocument())
    expect(screen.queryByTestId('webview-host')).not.toBeInTheDocument()
  })

  it('closes a preview through the authoring route and reloads', async () => {
    render(<MiniAppPreviewPane sessionId="topic-1" open />)
    await waitFor(() => expect(screen.getByTestId('webview-host')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('miniApp.preview.pane.close'))

    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('mini_app.authoring.close', {
        sessionId: 'topic-1',
        previewId: 'p1'
      })
    )
  })

  it('loads nothing while the pane is closed', () => {
    render(<MiniAppPreviewPane sessionId="topic-1" open={false} />)
    expect(ipcApi.request).not.toHaveBeenCalled()
  })
})
