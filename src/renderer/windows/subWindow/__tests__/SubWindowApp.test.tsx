import { mockPopupService } from '@test-mocks/renderer/popup'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SubWindowApp from '../SubWindowApp'

const state = vi.hoisted(() => ({ themeThrows: false }))
const originalMatchMedia = window.matchMedia

// Cut the heavy shell import graph (SubWindowAppShell → TabRouter → routeTree.gen);
// the window owns MCP interactions even when no tab content is rendered.
vi.mock('../SubWindowAppShell', () => ({ SubWindowAppShell: () => null }))
vi.mock('@renderer/hooks/useWindowRuntime', () => ({ useWindowRuntime: () => {} }))
vi.mock('@renderer/components/layout/TabsProvider', () => ({
  TabsProvider: ({ children }: PropsWithChildren) => children
}))
vi.mock('@renderer/components/ConversationNotificationRuntime', () => ({ ConversationNotificationRuntime: () => null }))

vi.mock('@renderer/components/ThemeProvider', () => ({
  ThemeProvider: ({ children }: PropsWithChildren) => {
    if (state.themeThrows) throw new Error('theme provider boom')
    return children
  }
}))
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

describe('SubWindowApp', () => {
  beforeEach(() => {
    state.themeThrows = false
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    // useSyncExternalStore requires a stable empty snapshot from the shared popup mock.
    vi.spyOn(mockPopupService, 'getSnapshot').mockReturnValue([])
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
    vi.restoreAllMocks()
  })

  it('shows the window fatal fallback instead of a white screen when a provider throws', () => {
    state.themeThrows = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<SubWindowApp />)

    expect(screen.getByRole('alert')).toHaveTextContent('theme provider boom')
  })

  it('lets the detached window answer its MCP form and dismisses ended requests', async () => {
    await i18n.changeLanguage('en-US')
    const user = userEvent.setup()
    const listeners = new Map<string, Set<(payload: unknown) => void>>()
    vi.spyOn(window.api.ipcApi, 'on').mockImplementation((event, handler) => {
      const handlers = listeners.get(event) ?? new Set()
      handlers.add(handler)
      listeners.set(event, handlers)
      return () => handlers.delete(handler)
    })
    const request = vi.spyOn(window.api.ipcApi, 'request').mockResolvedValue({ ok: true, data: true })
    const interaction = {
      serverId: 'server-1',
      serverName: 'Form server',
      requestId: 'form-1',
      topicId: 'detached-topic',
      kind: 'elicitation',
      payload: {
        params: {
          message: 'Enter your name.',
          requestedSchema: {
            type: 'object',
            properties: { name: { type: 'string', title: 'Name' } },
            required: ['name']
          }
        }
      }
    }
    render(<SubWindowApp />)
    act(() => {
      listeners.get('mcp.interaction.requested')?.forEach((handler) => handler(interaction))
    })
    expect(await screen.findByRole('dialog')).toHaveTextContent('Enter your name.')
    await user.type(screen.getByRole('textbox', { name: 'Name *' }), 'Wei')
    await user.click(screen.getByRole('button', { name: /^Confirm$/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(request.mock.calls.filter(([route]) => route === 'mcp.interaction.respond')).toEqual([
      ['mcp.interaction.respond', { requestId: 'form-1', decision: 'accept', value: { name: 'Wei' } }]
    ])

    act(() => {
      listeners.get('mcp.interaction.requested')?.forEach((handler) => handler({ ...interaction, requestId: 'form-2' }))
    })
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    act(() => {
      listeners.get('mcp.interaction.ended')?.forEach((handler) => handler({ requestId: 'form-2' }))
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
