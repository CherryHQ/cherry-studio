import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WebviewTag } from 'electron'
import i18n from 'i18next'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { webviewRuntimeService } from '@renderer/services/WebviewRuntimeService'
import { miniAppResourceKey } from '@renderer/utils/miniAppKeepAlive'
import type { MiniApp } from '@shared/data/types/miniApp'

import MiniAppPane from '../MiniAppPane'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({ pinned: [], allApps: [], updateAppStatus: vi.fn() })
}))

vi.mock('@renderer/components/MiniApp/MiniAppDetailPanel', () => ({
  default: () => null
}))

vi.mock('@renderer/components/WebviewSearch', () => ({
  default: () => null
}))

const customApp: MiniApp = {
  appId: 'custom-chatgpt',
  kind: 'site',
  presetMiniAppId: null,
  status: 'enabled',
  orderKey: 'a0',
  name: 'ChatGPT',
  url: 'https://chat.openai.com',
  logoSrc: 'file:///files/chatgpt.webp'
}

const guests: HTMLElement[] = []
const resourceKey = miniAppResourceKey(customApp.appId)
let previousLanguage: string

beforeAll(async () => {
  previousLanguage = i18n.language
  await i18n.changeLanguage('en-US')
})

afterAll(() => i18n.changeLanguage(previousLanguage))

beforeEach(() => {
  webviewRuntimeService.dispose()
  webviewRuntimeService.sync(
    [
      {
        key: resourceKey,
        source: { src: customApp.url, partition: 'persist:webview' },
        visible: true,
        protected: false,
        lastAccessTime: 0
      }
    ],
    1
  )
})

// JSDOM provides DOM events; Electron supplies these navigation methods at runtime.
const createGuest = () => {
  const guest = document.createElement('webview')
  guest.dataset.miniAppId = customApp.appId
  const canGoBack = vi.fn(() => false)
  const canGoForward = vi.fn(() => false)
  Object.assign(guest, {
    canGoBack,
    canGoForward,
    goBack: vi.fn(),
    goForward: vi.fn(),
    getURL: vi.fn(() => customApp.url)
  })
  guests.push(guest)
  return { guest, canGoBack, canGoForward }
}

const bindGuest = (guest: WebviewTag) => {
  const resource = webviewRuntimeService.get(resourceKey)!
  webviewRuntimeService.bind(resourceKey, resource.instance, guest)
}

const reportLoaded = () => {
  const resource = webviewRuntimeService.get(resourceKey)!
  webviewRuntimeService.reportLoaded(resourceKey, resource.instance, true)
}

const navigationEvent = (type: string) => Object.assign(new Event(type), { isMainFrame: true, url: customApp.url })

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  guests.splice(0).forEach((guest) => guest.remove())
  webviewRuntimeService.dispose()
})

describe('MiniAppPane navigation', () => {
  it('recovers when no ready WebView is attached', async () => {
    const user = userEvent.setup()
    const replacement = createGuest()
    replacement.canGoBack.mockReturnValue(true)
    const original = webviewRuntimeService.get(resourceKey)!
    render(<MiniAppPane app={customApp} splitMode="open" onSplit={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Restart MiniApp' }))
    expect(webviewRuntimeService.get(resourceKey)!.instance).not.toBe(original.instance)
    expect(webviewRuntimeService.get(resourceKey)!.loaded).toBe(false)
    expect(screen.getByRole('button', { name: 'Go Back' })).toHaveAttribute('aria-disabled', 'true')

    act(() => {
      document.body.append(replacement.guest)
      bindGuest(replacement.guest)
      reportLoaded()
    })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Go Back' })).toHaveAttribute('aria-disabled', 'false')
    )
  })

  it('updates navigation buttons from the replacement WebView after restarting', async () => {
    const user = userEvent.setup()
    const original = createGuest()
    const replacement = createGuest()
    document.body.append(original.guest)
    bindGuest(original.guest)
    reportLoaded()
    render(<MiniAppPane app={customApp} splitMode="open" onSplit={vi.fn()} />)

    original.canGoBack.mockReturnValue(true)
    fireEvent(original.guest, navigationEvent('did-navigate'))
    const back = screen.getByRole('button', { name: 'Go Back' })
    const forward = screen.getByRole('button', { name: 'Go Forward' })
    await waitFor(() => expect(back).toHaveAttribute('aria-disabled', 'false'))

    await user.click(screen.getByRole('button', { name: 'Restart MiniApp' }))
    act(() => {
      original.guest.replaceWith(replacement.guest)
      bindGuest(replacement.guest)
      reportLoaded()
    })

    replacement.canGoForward.mockReturnValue(true)
    fireEvent(replacement.guest, navigationEvent('did-navigate-in-page'))
    await waitFor(() => expect(forward).toHaveAttribute('aria-disabled', 'false'))
    expect(back).toHaveAttribute('aria-disabled', 'true')

    replacement.canGoBack.mockReturnValue(true)
    replacement.canGoForward.mockReturnValue(false)
    fireEvent(replacement.guest, navigationEvent('did-navigate'))
    await waitFor(() => expect(back).toHaveAttribute('aria-disabled', 'false'))
    expect(forward).toHaveAttribute('aria-disabled', 'true')
    await user.click(back)
    expect(replacement.guest.goBack).toHaveBeenCalledOnce()
    expect(original.guest.goBack).not.toHaveBeenCalled()
  })

  it('ignores pending updates and later events from the replaced WebView', async () => {
    const original = createGuest()
    const replacement = createGuest()
    original.canGoBack.mockReturnValue(true)
    replacement.canGoBack.mockReturnValue(true)
    document.body.append(original.guest)
    bindGuest(original.guest)
    reportLoaded()
    render(<MiniAppPane app={customApp} splitMode="open" onSplit={vi.fn()} />)
    const back = screen.getByRole('button', { name: 'Go Back' })
    const forward = screen.getByRole('button', { name: 'Go Forward' })
    expect(back).toHaveAttribute('aria-disabled', 'false')

    vi.useFakeTimers()
    original.canGoBack.mockReturnValue(false)
    original.canGoForward.mockReturnValue(true)
    fireEvent(original.guest, navigationEvent('did-navigate'))
    act(() => webviewRuntimeService.restart(resourceKey))
    act(() => {
      original.guest.replaceWith(replacement.guest)
      bindGuest(replacement.guest)
      reportLoaded()
    })
    await act(() => vi.advanceTimersByTimeAsync(100))

    expect(back).toHaveAttribute('aria-disabled', 'false')
    expect(forward).toHaveAttribute('aria-disabled', 'true')

    fireEvent(original.guest, navigationEvent('did-navigate-in-page'))
    await act(() => vi.advanceTimersByTimeAsync(100))

    expect(back).toHaveAttribute('aria-disabled', 'false')
    expect(forward).toHaveAttribute('aria-disabled', 'true')
  })
})
