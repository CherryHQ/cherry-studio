import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentChannelsTab } from '../AgentChannelsTab'

const mocks = vi.hoisted(() => ({ channels: [] as any[], create: vi.fn(), update: vi.fn(), open: vi.fn() }))
vi.mock('@renderer/hooks/agent/useChannels', () => ({
  useChannels: () => ({
    channels: mocks.channels,
    isLoading: false,
    createChannel: mocks.create,
    updateChannel: mocks.update
  })
}))
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openSettingsTab: mocks.open }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const channel = (id: string, type: string, agentId: string | null, isActive = true) => ({ id, type, agentId, isActive })

describe('AgentChannelsTab binding contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.channels = []
    mocks.create.mockResolvedValue({})
    mocks.update.mockResolvedValue({})
  })

  it('reflects only this agent bindings after a reload', () => {
    mocks.channels = [channel('mine', 'telegram', 'agent-1'), channel('other', 'discord', 'agent-2')]
    const view = render(
      <AgentChannelsTab agentId="agent-1" onSettingsNavigate={() => mocks.open('/settings/channels')} />
    )
    expect(screen.getByRole('switch', { name: 'Telegram' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Discord' })).not.toBeChecked()
    view.unmount()
    render(<AgentChannelsTab agentId="agent-1" onSettingsNavigate={() => mocks.open('/settings/channels')} />)
    expect(screen.getByRole('switch', { name: 'Telegram' })).toBeChecked()
  })

  it('reuses an unbound channel without changing activation or credentials', async () => {
    mocks.channels = [channel('unbound', 'telegram', null, false)]
    render(<AgentChannelsTab agentId="agent-1" onSettingsNavigate={() => mocks.open('/settings/channels')} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Telegram' }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('unbound', { agentId: 'agent-1' }))
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('creates credential-gated channels inactive', async () => {
    render(<AgentChannelsTab agentId="agent-1" onSettingsNavigate={() => mocks.open('/settings/channels')} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Telegram' }))
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'telegram', agentId: 'agent-1', isActive: false })
      )
    )
  })

  it('creates QR channels active and keeps a setup route visible for authentication', async () => {
    const view = render(
      <AgentChannelsTab agentId="agent-1" onSettingsNavigate={() => mocks.open('/settings/channels')} />
    )
    fireEvent.click(screen.getByRole('switch', { name: 'WeChat' }))
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'wechat', isActive: true }))
    )
    mocks.channels = [channel('qr', 'wechat', 'agent-1')]
    view.rerender(<AgentChannelsTab agentId="agent-1" onSettingsNavigate={() => mocks.open('/settings/channels')} />)
    fireEvent.click(screen.getByRole('button', { name: 'agent.channels.agentTab.openSettings' }))
    expect(mocks.open).toHaveBeenCalledWith('/settings/channels')
  })

  it('unbinds all of this agent channels but leaves another agent untouched', async () => {
    mocks.channels = [
      channel('one', 'telegram', 'agent-1'),
      channel('two', 'telegram', 'agent-1'),
      channel('other', 'telegram', 'agent-2')
    ]
    render(<AgentChannelsTab agentId="agent-1" onSettingsNavigate={() => mocks.open('/settings/channels')} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Telegram' }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2))
    expect(mocks.update).toHaveBeenCalledWith('one', { agentId: null })
    expect(mocks.update).toHaveBeenCalledWith('two', { agentId: null })
  })
})
