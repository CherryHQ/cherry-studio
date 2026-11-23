import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import type { LocalAgentConfigOption, LocalAgentSelection } from '@shared/ai/localAgent'

import { LocalAgentPermissionControl } from '../LocalAgentPermissionControl'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openRoute: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(ipcApi.request).mockReset()
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

describe('LocalAgentPermissionControl', () => {
  it('renders nothing when there are no configurable permission modes or security options', () => {
    const { container } = render(
      <LocalAgentPermissionControl
        sessionId="session"
        mode={{ id: 'mode', currentValue: 'only', options: [{ value: 'only', name: 'Only' }] }}
        securityOptions={[]}
        disabled={false}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows flat mode and security sections, risk indicator, scope caption, and settings shortcut', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockResolvedValue(null)
    const mode: LocalAgentSelection = {
      id: 'mode',
      currentValue: 'default',
      options: [
        { value: 'default', name: 'Default' },
        { value: 'plan', name: 'Plan' },
        { value: 'bypassPermissions', name: 'Bypass Permissions' }
      ]
    }
    const securityOptions: LocalAgentConfigOption[] = [
      {
        id: 'sandbox',
        name: 'Sandbox',
        type: 'select',
        currentValue: 'false',
        options: [
          { value: 'true', name: 'Sandbox Environment' },
          { value: 'false', name: 'Local Environment' }
        ]
      }
    ]
    render(
      <LocalAgentPermissionControl
        sessionId="session"
        agentId="agent-1"
        agentName="Claude Local"
        presetId="codebuddy-code"
        mode={mode}
        securityOptions={securityOptions}
        disabled={false}
      />
    )

    const trigger = screen.getByRole('button', { name: '权限审批' })
    expect(trigger).toHaveTextContent('默认 · 本机环境')
    expect(trigger.className).toContain('text-warning-subtle-foreground')

    await user.click(trigger)
    expect(screen.getByText('仅对当前会话生效')).toBeVisible()
    expect(screen.getByRole('menuitemradio', { name: '计划' })).toBeVisible()
    expect(screen.getByRole('menuitemradio', { name: '沙箱环境' })).toBeVisible()

    await user.click(screen.getByRole('menuitemradio', { name: '计划' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_mode', {
        sessionId: 'session',
        configId: 'mode',
        value: 'plan'
      })
    )

    fireEvent.click(screen.getByRole('menuitem', { name: '编辑默认配置' }))
    expect(openRoute).toHaveBeenCalledWith('/settings/local-agents', { id: 'codebuddy-code' })
  })

  it('requires confirmation before enabling high-risk mode or allow_all and submits only when confirmed', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockResolvedValue(null)
    render(
      <LocalAgentPermissionControl
        sessionId="session"
        agentId="agent-1"
        agentName="Copilot Local"
        presetId="copilot"
        mode={{
          id: 'mode',
          currentValue: 'agent',
          options: [
            { value: 'agent', name: 'Agent' },
            { value: 'autopilot', name: 'Autopilot' }
          ]
        }}
        securityOptions={[
          {
            id: 'allow_all',
            name: 'Allow All',
            type: 'boolean',
            currentValue: false
          }
        ]}
        disabled={false}
      />
    )

    await user.click(screen.getByRole('button', { name: '权限审批' }))
    await user.click(screen.getByRole('menuitemradio', { name: '自动执行（高风险）' }))
    expect(ipcApi.request).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog')).toHaveTextContent('Copilot Local')
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(ipcApi.request).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '权限审批' }))
    await user.click(screen.getByRole('menuitemradio', { name: '已启用' }))
    expect(ipcApi.request).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: '启用完全访问' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_config_option', {
        sessionId: 'session',
        configId: 'allow_all',
        value: true
      })
    )
  })
})
