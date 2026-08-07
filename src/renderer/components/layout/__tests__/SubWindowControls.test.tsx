import type { Tab } from '@renderer/hooks/tab'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type * as ReactI18nextModule from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SubWindowControls } from '../SubWindowControls'

const tab: Tab = {
  id: 'topic-1',
  type: 'route',
  url: '/app/chat?topicId=topic-1',
  title: 'Daily Standup',
  icon: 'emoji:🤖'
}

// Detached sub-window hosts exactly one tab; controls read it directly.
vi.mock('@renderer/hooks/tab', () => ({
  useTabs: () => ({ tabs: [tab], activeTabId: 'topic-1' })
}))

// Return the key verbatim so assertions can target stable i18n keys (keep other exports).
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

// The controls talk to main only through the typed IpcApi facade.
const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request }, useIpcOn: vi.fn() }))

beforeEach(() => {
  mocks.request.mockReset().mockResolvedValue(true)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('SubWindowControls', () => {
  it('toggles always-on-top and reflects the pressed state', async () => {
    render(<SubWindowControls />)

    const pinButton = screen.getByRole('button', { name: 'subWindow.pin' })
    expect(pinButton).toHaveAttribute('aria-pressed', 'false')

    await act(async () => {
      fireEvent.click(pinButton)
    })
    expect(mocks.request).toHaveBeenCalledWith('window.sub.set_always_on_top', true)

    const unpinButton = screen.getByRole('button', { name: 'subWindow.unpin' })
    expect(unpinButton).toHaveAttribute('aria-pressed', 'true')

    await act(async () => {
      fireEvent.click(unpinButton)
    })
    expect(mocks.request).toHaveBeenLastCalledWith('window.sub.set_always_on_top', false)
  })

  it('does not flip pressed state when the pin API fails', async () => {
    mocks.request.mockResolvedValueOnce(false)
    render(<SubWindowControls />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'subWindow.pin' }))
    })
    expect(mocks.request).toHaveBeenCalledWith('window.sub.set_always_on_top', true)

    // API returned false → button keeps the "pin" affordance, still not pressed.
    expect(screen.getByRole('button', { name: 'subWindow.pin' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('re-attaches the active tab to the main window via tab.attach', () => {
    render(<SubWindowControls />)

    fireEvent.click(screen.getByRole('button', { name: 'subWindow.back_to_main' }))
    expect(mocks.request).toHaveBeenCalledWith('tab.attach', tab)
  })
})
