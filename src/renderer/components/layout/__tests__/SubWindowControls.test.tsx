import type { Tab } from '@renderer/hooks/useTabs'
import { IpcChannel } from '@shared/IpcChannel'
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
vi.mock('@renderer/hooks/useTabs', () => ({
  useTabs: () => ({ tabs: [tab], activeTabId: 'topic-1' })
}))

// Return the key verbatim so assertions can target stable i18n keys (keep other exports).
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

const setAlwaysOnTop = vi.fn<(pinned: boolean) => Promise<boolean>>().mockResolvedValue(true)
const invoke = vi.fn().mockResolvedValue(true)

beforeEach(() => {
  setAlwaysOnTop.mockClear().mockResolvedValue(true)
  invoke.mockClear().mockResolvedValue(true)
  ;(window.api as any).window = { setAlwaysOnTop }
  ;(window.electron as any).ipcRenderer.invoke = invoke
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
    expect(setAlwaysOnTop).toHaveBeenCalledWith(true)

    const unpinButton = screen.getByRole('button', { name: 'subWindow.unpin' })
    expect(unpinButton).toHaveAttribute('aria-pressed', 'true')

    await act(async () => {
      fireEvent.click(unpinButton)
    })
    expect(setAlwaysOnTop).toHaveBeenLastCalledWith(false)
  })

  it('does not flip pressed state when the pin API fails', async () => {
    setAlwaysOnTop.mockResolvedValueOnce(false)
    render(<SubWindowControls />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'subWindow.pin' }))
    })
    expect(setAlwaysOnTop).toHaveBeenCalledWith(true)

    // API returned false → button keeps the "pin" affordance, still not pressed.
    expect(screen.getByRole('button', { name: 'subWindow.pin' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('re-attaches the active tab to the main window via Tab_Attach', () => {
    render(<SubWindowControls />)

    fireEvent.click(screen.getByRole('button', { name: 'subWindow.back_to_main' }))
    expect(invoke).toHaveBeenCalledWith(IpcChannel.Tab_Attach, tab)
  })
})
