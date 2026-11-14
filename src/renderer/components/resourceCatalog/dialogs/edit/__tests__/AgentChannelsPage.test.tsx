import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import { AgentChannelsPage } from '../AgentChannelsPage'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const { ipcRequest } = vi.hoisted(() => ({ ipcRequest: vi.fn() }))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequest },
  useIpcOn: vi.fn()
}))

const channel = (id: string, agentId: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  agentId,
  name,
  type: 'telegram',
  config: { bot_token: 'token', allowed_chat_ids: [] },
  isActive: true,
  permissionMode: null,
  workspace: { type: 'system' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra
})

const ALL_CHANNELS = [
  channel('c1', 'agent-1', 'Team bot'),
  channel('c2', 'agent-2', 'Other agent bot'),
  channel('c3', 'agent-1', 'WeChat helper', { type: 'wechat', config: { token_path: '' }, isActive: false })
]

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  HTMLElement.prototype.hasPointerCapture ??= () => false
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.scrollIntoView = () => {}
})

beforeEach(() => {
  MockUseDataApiUtils.resetMocks()
  ipcRequest
    .mockReset()
    .mockImplementation(async (route: string, input: Record<string, unknown>) =>
      route === 'channel.create' ? { ...channel('new', 'agent-1', String(input.name)), ...input } : {}
    )
  // The server filters by `agentId`, as the channel list endpoint does.
  mockUseQuery.mockImplementation((path: string, options?: { query?: { agentId?: string } }) => ({
    data:
      path === '/agent-channels'
        ? ALL_CHANNELS.filter((item) => !options?.query?.agentId || item.agentId === options.query.agentId)
        : undefined,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: vi.fn(),
    mutate: vi.fn().mockResolvedValue(undefined)
  }))
})

function renderPage() {
  return render(<AgentChannelsPage agentId="agent-1" agentType="pi" permissionMode="default" portalContainer={null} />)
}

// AC6: the page shows, adds, toggles, and deletes only this Agent's channels through the channel commands.
describe('AgentChannelsPage', () => {
  it("lists only this Agent's channels", () => {
    renderPage()

    expect(screen.getByText('Team bot')).toBeInTheDocument()
    expect(screen.getByText('WeChat helper')).toBeInTheDocument()
    expect(screen.queryByText('Other agent bot')).not.toBeInTheDocument()
  })

  it('binds a channel added here to this Agent', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /添加频道/ }))
    await user.click(await screen.findByRole('menuitem', { name: /Telegram/ }))

    await waitFor(() =>
      expect(ipcRequest).toHaveBeenCalledWith(
        'channel.create',
        expect.objectContaining({ type: 'telegram', agentId: 'agent-1', isActive: false })
      )
    )
  })

  it('toggles and deletes a channel with the same commands Settings › Channels uses', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('switch', { name: /Team bot/ }))
    await waitFor(() =>
      expect(ipcRequest).toHaveBeenCalledWith('channel.update', { channelId: 'c1', updates: { isActive: false } })
    )

    await user.click(screen.getByRole('button', { name: '删除 Team bot' }))
    const confirm = await screen.findByRole('dialog')
    await user.click(within(confirm).getByRole('button', { name: '确认' }))
    await waitFor(() => expect(ipcRequest).toHaveBeenCalledWith('channel.delete', { channelId: 'c1' }))
  })

  it('runs a WeChat QR login from here when its channel is switched on', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('switch', { name: /WeChat helper/ }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await waitFor(() =>
      expect(ipcRequest).toHaveBeenCalledWith('channel.update', { channelId: 'c3', updates: { isActive: true } })
    )
  })
})
