import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { LocalAgentSelection } from '@shared/ai/localAgent'

import { LocalAgentThoughtControl } from '../LocalAgentThoughtControl'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(ipcApi.request).mockReset()
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

const claudeSelection: LocalAgentSelection = {
  id: 'claude-effort',
  currentValue: 'default',
  options: [
    { value: 'default', name: 'Default' },
    { value: 'low', name: 'Low' },
    { value: 'medium', name: 'Medium' },
    { value: 'high', name: 'High' },
    { value: 'max', name: 'Max' }
  ]
}

describe('LocalAgentThoughtControl', () => {
  it('reuses the speed slider popover for thoughtLevel and resets cleanly to default', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockResolvedValue(null)

    render(
      <LocalAgentThoughtControl
        sessionId="session-claude"
        kind="thought"
        selection={claudeSelection}
        presetId="claude"
        disabled={false}
      />
    )

    const trigger = screen.getByRole('button', { name: '响应设置' })
    expect(trigger).toHaveTextContent('默认')

    await user.click(trigger)
    expect(screen.getByTestId('model-speed-effort-label')).toHaveTextContent('默认')
    expect(screen.getByText('更快')).toBeVisible()
    expect(screen.getByText('更智能')).toBeVisible()
    expect(screen.queryByRole('button', { name: '默认' })).not.toBeInTheDocument()

    const slider = screen.getByRole('slider', { name: '强度' })
    slider.focus()
    await user.keyboard('{ArrowRight}')

    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_thought_level', {
        sessionId: 'session-claude',
        configId: 'claude-effort',
        value: 'medium'
      })
    )
    expect(screen.getByTestId('model-speed-effort-label')).toHaveTextContent('中')

    await user.click(screen.getByRole('button', { name: '默认' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_thought_level', {
        sessionId: 'session-claude',
        configId: 'claude-effort',
        value: 'default'
      })
    )
  })

  it('coalesces rapid slider changes and rolls back with toast on IPC error', async () => {
    const user = userEvent.setup()
    let resolveFirst!: (value: unknown) => void
    let callCount = 0
    vi.mocked(ipcApi.request).mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          callCount += 1
          if (callCount === 1) resolveFirst = resolve
          else reject(new Error('network failed'))
        })
    )

    render(
      <LocalAgentThoughtControl
        sessionId="session-codex"
        kind="thought"
        selection={{
          id: 'codex-effort',
          currentValue: 'low',
          options: [
            { value: 'default', name: 'Default' },
            { value: 'low', name: 'Low' },
            { value: 'medium', name: 'Medium' },
            { value: 'high', name: 'High' },
            { value: 'xhigh', name: 'Extra High' }
          ]
        }}
        presetId="codex"
        disabled={false}
      />
    )

    await user.click(screen.getByRole('button', { name: '响应设置' }))
    const slider = screen.getByRole('slider', { name: '强度' })
    slider.focus()
    await user.keyboard('{ArrowRight}')
    await user.keyboard('{ArrowRight}')
    await user.keyboard('{ArrowRight}')

    expect(screen.getByTestId('model-speed-effort-label')).toHaveTextContent('极高')
    expect(ipcApi.request).toHaveBeenCalledTimes(1)

    resolveFirst(null)
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenNthCalledWith(2, 'ai.local_agents.set_thought_level', {
        sessionId: 'session-codex',
        configId: 'codex-effort',
        value: 'xhigh'
      })
    )
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Error: network failed'))
    expect(screen.getByTestId('model-speed-effort-label')).toHaveTextContent('低')
  })

  it('routes ACP config thought_level with quick Off button and Pi mode via set_mode', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockResolvedValue(null)

    const { unmount } = render(
      <LocalAgentThoughtControl
        sessionId="session-acp"
        kind="config"
        selection={{
          id: 'reasoning_effort',
          currentValue: 'high',
          options: [
            { value: 'off', name: 'Off' },
            { value: 'low', name: 'Low' },
            { value: 'high', name: 'High' }
          ]
        }}
        disabled={false}
      />
    )

    await user.click(screen.getByRole('button', { name: '响应设置' }))
    await user.click(screen.getByRole('button', { name: '关闭' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_config_option', {
        sessionId: 'session-acp',
        configId: 'reasoning_effort',
        value: 'off'
      })
    )
    unmount()

    render(
      <LocalAgentThoughtControl
        sessionId="session-pi"
        kind="mode"
        selection={{
          id: 'mode',
          currentValue: 'medium',
          options: [
            { value: 'off', name: 'Thinking: off' },
            { value: 'minimal', name: 'Thinking: minimal' },
            { value: 'low', name: 'Thinking: low' },
            { value: 'medium', name: 'Thinking: medium' },
            { value: 'high', name: 'Thinking: high' }
          ]
        }}
        presetId="pi-acp"
        disabled={false}
      />
    )

    await user.click(screen.getByRole('button', { name: '响应设置' }))
    await user.click(screen.getByRole('button', { name: '关闭' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_mode', {
        sessionId: 'session-pi',
        configId: 'mode',
        value: 'off'
      })
    )
  })

  it('uses radio options for two-level controls and prevents edits while disabled', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockResolvedValue(null)

    render(
      <LocalAgentThoughtControl
        sessionId="session-disabled"
        kind="config"
        selection={{
          id: 'thinking',
          currentValue: 'high',
          options: [
            { value: 'off', name: 'Off' },
            { value: 'high', name: 'High' }
          ]
        }}
        disabled
      />
    )

    await user.click(screen.getByRole('button', { name: '响应设置' }))
    expect(screen.getByRole('status')).toHaveTextContent('生成结束且连接就绪后可修改。')
    fireEvent.click(screen.getByRole('radio', { name: '关闭' }))
    expect(ipcApi.request).not.toHaveBeenCalled()
  })
})
