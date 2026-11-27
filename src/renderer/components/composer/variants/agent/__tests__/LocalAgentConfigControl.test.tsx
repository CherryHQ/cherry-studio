import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { LocalAgentConfigOption } from '@shared/ai/localAgent'

import { LocalAgentConfigControl } from '../LocalAgentConfigControl'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn() } }))

const options: LocalAgentConfigOption[] = [
  {
    id: 'detail',
    name: 'Answer detail',
    description: 'Response length',
    type: 'select',
    currentValue: 'brief',
    options: [
      {
        group: 'levels',
        name: 'Detail levels',
        options: [
          { value: 'brief', name: 'Brief' },
          { value: 'full', name: 'Detailed', description: 'Include explanation' }
        ]
      }
    ]
  },
  { id: 'notify', name: 'Notifications', type: 'boolean', currentValue: false }
]
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(ipcApi.request).mockReset()
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

describe('LocalAgentConfigControl', () => {
  it('shows localized current values for grouped reasoning choices', async () => {
    const user = userEvent.setup()
    const thoughtLevel = {
      id: 'native-reasoning',
      currentValue: 'low',
      options: [
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' }
      ]
    }
    render(
      <LocalAgentConfigControl
        sessionId="session"
        disabled={false}
        options={[
          options[1],
          {
            ...thoughtLevel,
            name: 'Reasoning',
            category: 'thought_level',
            type: 'select',
            options: [{ group: 'levels', name: 'Thinking levels', options: thoughtLevel.options }]
          },
          options[0]
        ]}
      />
    )
    await user.click(screen.getByRole('button', { name: '智能体配置' }))
    fireEvent.keyDown(screen.getByRole('menuitem', { name: '思考强度' }), { key: 'ArrowRight' })
    expect(screen.getByRole('menuitemradio', { name: '低' })).toHaveAttribute('aria-checked', 'true')
  })

  it('keeps the confirmed setting when a change is rejected', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockRejectedValue(new Error('Cannot switch now'))
    const selection: LocalAgentConfigOption = {
      id: 'native-config',
      name: 'Output level',
      type: 'select',
      currentValue: 'low',
      options: [
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' }
      ]
    }
    render(<LocalAgentConfigControl sessionId="session" options={[selection]} disabled={false} />)
    const trigger = screen.getByRole('button', { name: '智能体配置' })
    expect(trigger).toHaveTextContent('Output level：Low')
    await user.click(trigger)
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitemradio', { name: 'High' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Error: Cannot switch now'))
    expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_config_option', {
      sessionId: 'session',
      configId: 'native-config',
      value: 'high'
    })
    const confirmed = screen.getByRole('menuitemradio', { name: 'Low' })
    expect(confirmed).toHaveAttribute('aria-checked', 'true')
    expect(confirmed).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('keeps high-risk permissions visible in the collapsed summary', () => {
    render(
      <LocalAgentConfigControl
        sessionId="session"
        disabled={false}
        options={[
          {
            id: 'mode',
            name: 'Mode',
            type: 'select',
            role: 'mode',
            currentValue: 'full',
            options: [
              { value: 'ask', name: 'Always Ask' },
              { value: 'full', name: 'Full Access', permissionMode: 'bypassPermissions' }
            ]
          }
        ]}
      />
    )
    expect(screen.getByRole('button', { name: '智能体配置' })).toHaveTextContent('完全访问（高风险）')
  })

  it('renders native descriptions and groups, and applies only confirmed selections', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockResolvedValue(null)
    const { rerender } = render(<LocalAgentConfigControl sessionId="session" options={options} disabled={false} />)
    await user.click(screen.getByRole('button', { name: '智能体配置' }))
    fireEvent.keyDown(screen.getByRole('menuitem', { name: '回答详细程度' }), { key: 'ArrowRight' })
    fireEvent.click(screen.getByRole('menuitemradio', { name: '详细 包含解释' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_config_option', {
        sessionId: 'session',
        configId: 'detail',
        value: 'full'
      })
    )
    expect(screen.getByRole('menuitem', { name: '回答详细程度' })).toHaveTextContent('简短')
    rerender(
      <LocalAgentConfigControl
        sessionId="session"
        options={[{ ...options[0], currentValue: 'full' } as LocalAgentConfigOption, options[1]]}
        disabled={false}
      />
    )
    expect(screen.getByRole('menuitem', { name: '回答详细程度' })).toHaveTextContent('详细')
    rerender(<LocalAgentConfigControl sessionId="session" options={[]} disabled={false} />)
    expect(screen.queryByRole('button', { name: '智能体配置' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('sends boolean values and blocks duplicate changes while saving', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockReturnValue(new Promise(() => {}))
    render(<LocalAgentConfigControl sessionId="session" options={options} disabled={false} />)
    await user.click(screen.getByRole('button', { name: '智能体配置' }))
    fireEvent.keyDown(screen.getByRole('menuitem', { name: '通知' }), { key: 'ArrowRight' })
    expect(screen.getByRole('menuitemradio', { name: '已禁用' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('menuitemradio', { name: '已启用' }))
    expect(screen.getByRole('menuitem', { name: '通知' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: '回答详细程度' })).toHaveAttribute('aria-disabled', 'true')
    expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_config_option', {
      sessionId: 'session',
      configId: 'notify',
      value: true
    })
  })

  it('allows inspection while read-only and resumes changing settings when ready', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<LocalAgentConfigControl sessionId="session" options={options} disabled />)
    await user.click(screen.getByRole('button', { name: '智能体配置' }))
    await user.click(screen.getByRole('menuitem', { name: '通知' }))
    const enabledChoice = await screen.findByRole('menuitemradio', { name: '已启用' })
    expect(enabledChoice).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(enabledChoice)
    expect(screen.getByRole('menuitemradio', { name: '已禁用' })).toHaveAttribute('aria-checked', 'true')
    expect(ipcApi.request).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toBeVisible()

    rerender(<LocalAgentConfigControl sessionId="session" options={options} disabled={false} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitemradio', { name: '已启用' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_config_option', {
        sessionId: 'session',
        configId: 'notify',
        value: true
      })
    )
  })

  it('requires confirmation before switching a setting to the unsandboxed environment', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockResolvedValue(null)
    render(
      <LocalAgentConfigControl
        sessionId="session"
        agentName="Codex Local"
        presetId="codebuddy-code"
        disabled={false}
        options={[
          {
            id: 'sandbox',
            name: 'Sandbox',
            type: 'select',
            currentValue: 'true',
            options: [
              { value: 'true', name: 'Sandbox Environment' },
              { value: 'false', name: 'Local Environment', requiresConfirmation: true }
            ]
          }
        ]}
      />
    )

    await user.click(screen.getByRole('button', { name: '智能体配置' }))
    await user.click(screen.getByRole('menuitemradio', { name: '本机环境' }))

    expect(ipcApi.request).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog')).toHaveTextContent('Codex Local')
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(ipcApi.request).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '智能体配置' }))
    await user.click(screen.getByRole('menuitemradio', { name: '本机环境' }))

    expect(ipcApi.request).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: '启用完全访问' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_config_option', {
        sessionId: 'session',
        configId: 'sandbox',
        value: 'false'
      })
    )
  })

  it('keeps extra native selectors on the generic settings action', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockResolvedValue(null)
    render(
      <LocalAgentConfigControl
        sessionId="session"
        disabled={false}
        options={[
          {
            id: 'custom-think-id',
            name: 'Thinking',
            role: 'reasoning',
            type: 'select',
            currentValue: 'medium',
            options: [
              { value: 'low', name: 'Low' },
              { value: 'medium', name: 'Medium' }
            ]
          }
        ]}
      />
    )
    await user.click(screen.getByRole('button', { name: '智能体配置' }))
    await user.click(screen.getByRole('menuitemradio', { name: '低' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_config_option', {
        sessionId: 'session',
        configId: 'custom-think-id',
        value: 'low'
      })
    )
  })
})
