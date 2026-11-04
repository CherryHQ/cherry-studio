import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WebviewTag } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMiniApp } from '@renderer/hooks/__tests__/fixtures/miniApp'
import { webviewRuntimeService } from '@renderer/services/WebviewRuntimeService'

import MiniAppPane from '../MiniAppPane'

vi.mock('../MinimalToolbar', () => ({
  default: ({ isWebviewReady, onReload }: { isWebviewReady: boolean; onReload: () => void }) => (
    <button type="button" disabled={!isWebviewReady} onClick={onReload}>
      Reload
    </button>
  )
}))
vi.mock('@renderer/components/WebviewSearch', () => ({ default: () => null }))

const app = createMiniApp('a')
const key = 'miniapp:a'
const request = {
  key,
  source: { src: app.url, partition: 'persist:webview' },
  visible: true,
  protected: false,
  lastAccessTime: 0
}
const mount = (onActivate = vi.fn()) =>
  render(<MiniAppPane app={app} splitMode="open" onSplit={vi.fn()} onActivate={onActivate} />)
const bind = () => {
  const guest = document.createElement('webview')
  guest.reload = vi.fn()
  document.body.appendChild(guest)
  const instance = webviewRuntimeService.get(key)!.instance
  webviewRuntimeService.bind(key, instance, guest)
  webviewRuntimeService.reportLoaded(key, instance, true)
  return guest
}

beforeEach(() => {
  webviewRuntimeService.dispose()
  webviewRuntimeService.sync([request], 10)
})
afterEach(() => {
  cleanup()
  document.querySelectorAll('webview').forEach((guest) => guest.remove())
})

describe('MiniAppPane resource binding', () => {
  it('uses an already loaded guest after a pane remount and reloads that guest', async () => {
    const user = userEvent.setup()
    const guest = bind()
    guest.src = 'https://a.example/current-page'
    mount()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Reload' }))
    expect(guest.reload).toHaveBeenCalledOnce()
    expect(guest.src).toBe('https://a.example/current-page')
  })

  it('disables guest actions on eviction until the replacement finishes loading', () => {
    bind()
    mount()
    act(() => webviewRuntimeService.sync([], 10))
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled()
    act(() => webviewRuntimeService.sync([request], 10))
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled()
    act(() => {
      bind()
    })
    expect(screen.getByRole('button', { name: 'Reload' })).toBeEnabled()
  })

  it('stops listening to a retired guest when the resource is replaced', () => {
    const first = bind()
    const activate = vi.fn()
    mount(activate)
    act(() => {
      first.dispatchEvent(new Event('focus'))
    })
    expect(activate).toHaveBeenCalledOnce()
    act(() => {
      webviewRuntimeService.sync([], 10)
      webviewRuntimeService.sync([request], 10)
    })
    let next!: WebviewTag
    act(() => {
      next = bind()
    })
    activate.mockClear()
    act(() => {
      first.dispatchEvent(new Event('focus'))
    })
    expect(activate).not.toHaveBeenCalled()
    act(() => {
      next.dispatchEvent(new Event('focus'))
    })
    expect(activate).toHaveBeenCalledOnce()
  })
})
