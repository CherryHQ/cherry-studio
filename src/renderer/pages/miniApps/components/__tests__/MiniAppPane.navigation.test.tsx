import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  clearAllWebviewStates,
  getWebviewLoaded,
  setWebviewElement,
  setWebviewLoaded
} from '@renderer/services/MiniAppWebviewService'
import { webviewRecreationService } from '@renderer/services/WebviewRecreationService'
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
const subscriptions: Array<() => void> = []
let previousLanguage: string

beforeAll(async () => {
  previousLanguage = i18n.language
  await i18n.changeLanguage('en-US')
})

afterAll(() => i18n.changeLanguage(previousLanguage))

// JSDOM provides DOM events; Electron supplies these navigation methods at runtime.
const createGuest = () => {
  const guest = document.createElement('webview')
  guest.dataset.miniAppId = customApp.appId
  const canGoBack = vi.fn(() => false)
  const canGoForward = vi.fn(() => false)
  Object.assign(guest, { canGoBack, canGoForward, getURL: vi.fn(() => customApp.url) })
  guests.push(guest)
  return { guest, canGoBack, canGoForward }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  subscriptions.splice(0).forEach((unsubscribe) => unsubscribe())
  guests.splice(0).forEach((guest) => guest.remove())
  clearAllWebviewStates()
})

describe('MiniAppPane navigation', () => {
  it('recovers when no ready WebView is attached', async () => {
    const user = userEvent.setup()
    const replacement = createGuest()
    replacement.canGoBack.mockReturnValue(true)
    subscriptions.push(
      webviewRecreationService.subscribe(() => {
        document.body.append(replacement.guest)
        setWebviewElement(customApp.appId, replacement.guest)
      })
    )
    render(<MiniAppPane app={customApp} splitMode="open" onSplit={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Restart MiniApp' }))
    expect(replacement.guest.isConnected).toBe(true)
    expect(getWebviewLoaded(customApp.appId)).toBe(false)

    act(() => setWebviewLoaded(customApp.appId, true))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Go Back' })).toHaveAttribute('aria-disabled', 'false')
    )
  })

  it('updates navigation buttons from the replacement WebView after restarting', async () => {
    const user = userEvent.setup()
    const original = createGuest()
    const replacement = createGuest()
    document.body.append(original.guest)
    setWebviewElement(customApp.appId, original.guest)
    setWebviewLoaded(customApp.appId, true)
    subscriptions.push(
      webviewRecreationService.subscribe(() => {
        original.guest.replaceWith(replacement.guest)
        setWebviewElement(customApp.appId, replacement.guest)
      })
    )
    render(<MiniAppPane app={customApp} splitMode="open" onSplit={vi.fn()} />)

    original.canGoBack.mockReturnValue(true)
    fireEvent(original.guest, new Event('did-navigate'))
    const back = screen.getByRole('button', { name: 'Go Back' })
    const forward = screen.getByRole('button', { name: 'Go Forward' })
    await waitFor(() => expect(back).toHaveAttribute('aria-disabled', 'false'))

    await user.click(screen.getByRole('button', { name: 'Restart MiniApp' }))
    act(() => setWebviewLoaded(customApp.appId, true))

    replacement.canGoForward.mockReturnValue(true)
    fireEvent(replacement.guest, new Event('did-navigate-in-page'))
    await waitFor(() => expect(forward).toHaveAttribute('aria-disabled', 'false'))
    expect(back).toHaveAttribute('aria-disabled', 'true')

    replacement.canGoBack.mockReturnValue(true)
    replacement.canGoForward.mockReturnValue(false)
    fireEvent(replacement.guest, new Event('did-navigate'))
    await waitFor(() => expect(back).toHaveAttribute('aria-disabled', 'false'))
    expect(forward).toHaveAttribute('aria-disabled', 'true')
  })

  it('ignores pending updates and later events from the replaced WebView', async () => {
    const original = createGuest()
    const replacement = createGuest()
    original.canGoBack.mockReturnValue(true)
    replacement.canGoBack.mockReturnValue(true)
    document.body.append(original.guest)
    setWebviewElement(customApp.appId, original.guest)
    setWebviewLoaded(customApp.appId, true)
    subscriptions.push(
      webviewRecreationService.subscribe(() => {
        original.guest.replaceWith(replacement.guest)
        setWebviewElement(customApp.appId, replacement.guest)
      })
    )
    render(<MiniAppPane app={customApp} splitMode="open" onSplit={vi.fn()} />)
    const back = screen.getByRole('button', { name: 'Go Back' })
    const forward = screen.getByRole('button', { name: 'Go Forward' })
    expect(back).toHaveAttribute('aria-disabled', 'false')

    vi.useFakeTimers()
    original.canGoBack.mockReturnValue(false)
    original.canGoForward.mockReturnValue(true)
    fireEvent(original.guest, new Event('did-navigate'))
    act(() => webviewRecreationService.request(customApp.appId))
    act(() => setWebviewLoaded(customApp.appId, true))
    await act(() => vi.advanceTimersByTimeAsync(100))

    expect(back).toHaveAttribute('aria-disabled', 'false')
    expect(forward).toHaveAttribute('aria-disabled', 'true')

    fireEvent(original.guest, new Event('did-navigate-in-page'))
    await act(() => vi.advanceTimersByTimeAsync(100))

    expect(back).toHaveAttribute('aria-disabled', 'false')
    expect(forward).toHaveAttribute('aria-disabled', 'true')
  })
})
