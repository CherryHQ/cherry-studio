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
  it.each([
    ['mode', 'ai.local_agents.set_mode'],
    ['thoughtLevel', 'ai.local_agents.set_thought_level']
  ] as const)('opens a lone %s directly and keeps the confirmed selection when rejected', async (kind, route) => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockRejectedValue(new Error('Cannot switch now'))
    const selection = {
      id: 'native-config',
      currentValue: 'low',
      options: [
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' }
      ]
    }
    render(<LocalAgentConfigControl sessionId="session" {...{ [kind]: selection }} disabled={false} />)
    const trigger = screen.getByRole('button', { name: '智能体配置' })
    expect(trigger).toHaveTextContent(kind === 'mode' ? '会话模式：Low' : '思考强度：低')
    await user.click(trigger)
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitemradio', { name: kind === 'mode' ? 'High' : '高' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Error: Cannot switch now'))
    expect(ipcApi.request).toHaveBeenCalledWith(route, {
      sessionId: 'session',
      configId: 'native-config',
      value: 'high'
    })
    const confirmed = screen.getByRole('menuitemradio', { name: kind === 'mode' ? 'Low' : '低' })
    expect(confirmed).toHaveAttribute('aria-checked', 'true')
    expect(confirmed).not.toHaveAttribute('aria-disabled', 'true')
  })

  it.each(['mode', 'thoughtLevel'] as const)('hides a fixed %s without a configurable choice', (kind) => {
    render(
      <LocalAgentConfigControl
        sessionId="session"
        disabled={false}
        {...{
          [kind]: { id: 'fixed', currentValue: 'only', options: [{ value: 'only', name: 'Only' }] }
        }}
      />
    )
    expect(screen.queryByRole('button', { name: '智能体配置' })).not.toBeInTheDocument()
  })

  it('offers mode, reasoning, and extra settings through one entry and keeps confirmed values while saving', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockReturnValue(new Promise(() => {}))
    render(
      <LocalAgentConfigControl
        sessionId="session"
        options={options}
        disabled={false}
        mode={{
          id: 'mode',
          currentValue: 'ask',
          options: [
            { value: 'ask', name: 'Always Ask' },
            { value: 'plan', name: 'Plan' }
          ]
        }}
        thoughtLevel={{
          id: 'reasoning',
          currentValue: 'low',
          options: [
            { value: 'low', name: 'Low' },
            { value: 'high', name: 'High' }
          ]
        }}
      />
    )
    const trigger = screen.getByRole('button', { name: '智能体配置' })
    expect(trigger).toHaveTextContent('始终询问')
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
    await user.click(trigger)
    expect(screen.getByRole('menuitem', { name: '会话模式' })).toHaveTextContent('始终询问')
    const reasoning = screen.getByRole('menuitem', { name: '思考强度' })
    const originalValue = reasoning.textContent
    fireEvent.keyDown(reasoning, { key: 'ArrowRight' })
    fireEvent.click(screen.getByRole('menuitemradio', { name: '高' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_thought_level', {
        sessionId: 'session',
        configId: 'reasoning',
        value: 'high'
      })
    )
    expect(reasoning).toHaveTextContent(originalValue)
    expect(screen.getByRole('menuitem', { name: '会话模式' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: 'Notifications' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('keeps high-risk permissions visible in the collapsed summary', () => {
    render(
      <LocalAgentConfigControl
        sessionId="session"
        disabled={false}
        mode={{
          id: 'mode',
          currentValue: 'full',
          options: [
            { value: 'ask', name: 'Always Ask' },
            { value: 'full', name: 'Full Access' }
          ]
        }}
      />
    )
    expect(screen.getByRole('button', { name: '智能体配置' })).toHaveTextContent('完全访问（高风险）')
  })

  it('renders native descriptions and groups, and applies only confirmed selections', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockResolvedValue(null)
    const { rerender } = render(<LocalAgentConfigControl sessionId="session" options={options} disabled={false} />)
    await user.click(screen.getByRole('button', { name: '智能体配置' }))
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Answer detail' }), { key: 'ArrowRight' })
    expect(screen.getByText('Detail levels')).toBeVisible()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Detailed Include explanation' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_config_option', {
        sessionId: 'session',
        configId: 'detail',
        value: 'full'
      })
    )
    expect(screen.getByRole('menuitem', { name: 'Answer detail' })).toHaveTextContent('Brief')
    rerender(
      <LocalAgentConfigControl
        sessionId="session"
        options={[{ ...options[0], currentValue: 'full' } as LocalAgentConfigOption, options[1]]}
        disabled={false}
      />
    )
    expect(screen.getByRole('menuitem', { name: 'Answer detail' })).toHaveTextContent('Detailed')
    rerender(<LocalAgentConfigControl sessionId="session" options={[]} disabled={false} />)
    expect(screen.queryByRole('button', { name: '智能体配置' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('sends boolean values and blocks duplicate changes while saving', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockReturnValue(new Promise(() => {}))
    render(<LocalAgentConfigControl sessionId="session" options={options} disabled={false} />)
    await user.click(screen.getByRole('button', { name: '智能体配置' }))
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Notifications' }), { key: 'ArrowRight' })
    expect(screen.getByRole('menuitemradio', { name: '已禁用' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('menuitemradio', { name: '已启用' }))
    expect(screen.getByRole('menuitem', { name: 'Notifications' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: 'Answer detail' })).toHaveAttribute('aria-disabled', 'true')
    expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_config_option', {
      sessionId: 'session',
      configId: 'notify',
      value: true
    })
  })

  it('keeps advertised settings read-only while a turn is running', async () => {
    const user = userEvent.setup()
    render(<LocalAgentConfigControl sessionId="session" options={options} disabled />)
    await user.click(screen.getByRole('button', { name: '智能体配置' }))
    expect(screen.getByRole('menuitem', { name: 'Notifications' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: 'Answer detail' })).toHaveAttribute('aria-disabled', 'true')
  })
})
