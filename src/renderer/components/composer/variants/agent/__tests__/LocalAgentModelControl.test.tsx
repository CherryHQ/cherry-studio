import { webcrypto } from 'node:crypto'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { AgentEntity } from '@shared/data/types/agent'

import { LocalAgentModelControl } from '../LocalAgentModelControl'

vi.mock('@renderer/hooks/useModel', () => ({ useModels: () => ({ models: [] }) }))
vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [] }),
  getProviderDisplayName: (provider: { name: string }) => provider.name
}))
vi.unmock('@cherrystudio/ui')
vi.unmock('@data/hooks/useCache')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
const { updateNativeModel } = vi.hoisted(() => ({ updateNativeModel: vi.fn() }))
vi.mock('@renderer/hooks/agent/useAgent', () => ({ useUpdateAgent: () => ({ updateNativeModel }) }))

const agent: AgentEntity = {
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  orderKey: 'a0',
  model: null,
  modelName: null,
  id: 'local-agent',
  name: 'Local',
  type: 'local',
  configuration: {
    localRuntime: { protocol: 'acp', presetId: 'opencode', enabled: true, args: [], env: {}, nativeModel: 'first' }
  }
}
const info = {
  images: false,
  resume: true,
  models: [
    { id: 'first', name: 'First' },
    { id: 'second', name: 'Second' }
  ]
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  HTMLElement.prototype.scrollIntoView = vi.fn()
  updateNativeModel.mockReset()
  vi.mocked(ipcApi.request).mockImplementation(
    async () => ({ files: [{ target: 'opencode-config', path: '/test/opencode.json', content: null }] }) as never
  )
})

describe('local agent model persistence', () => {
  it('edits session model parameters in the model picker without changing the global model', async () => {
    const user = userEvent.setup()
    render(
      <LocalAgentModelControl
        agent={agent}
        sessionId="session"
        info={{
          ...info,
          configOptions: [
            {
              id: 'context-size',
              name: 'Context size',
              category: 'model_config',
              type: 'select',
              currentValue: 'small',
              options: [
                { value: 'small', name: 'Small' },
                { value: 'large', name: 'Large' }
              ]
            },
            { id: 'notifications', name: 'Notifications', type: 'boolean', currentValue: false }
          ]
        }}
        disabled={false}
        side="bottom"
      />
    )
    expect(screen.queryByRole('button', { name: '智能体配置' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '选择模型' }))
    await user.click(screen.getByRole('button', { name: '智能体配置' }))
    expect(screen.getByRole('dialog')).toContainElement(screen.getByRole('menuitemradio', { name: '大' }))
    expect(screen.queryByText('通知')).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitemradio', { name: '大' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.set_config_option', {
        sessionId: 'session',
        configId: 'context-size',
        value: 'large'
      })
    )
    expect(updateNativeModel).not.toHaveBeenCalled()
    expect(screen.getByRole('menuitemradio', { name: '小' })).toHaveAttribute('aria-checked', 'true')
  })

  it.each([
    ['Second', 'second'],
    ['跟随 CLI', undefined]
  ] as const)('retains the selection on failure and allows retry: %s', async (label, nativeModel) => {
    const user = userEvent.setup()
    updateNativeModel.mockResolvedValueOnce(undefined).mockResolvedValueOnce(agent)
    render(<LocalAgentModelControl agent={agent} info={info} disabled={false} side="bottom" />)
    await user.click(screen.getByRole('button', { name: '选择模型' }))
    await user.click(await screen.findByText(label))
    expect(await screen.findByText(label)).toBeVisible()
    expect(screen.getByRole('button', { name: '选择模型' })).toHaveTextContent('First')
    await user.click(screen.getByText(label))
    await waitFor(() => expect(screen.queryByText(label)).not.toBeInTheDocument())
    expect(updateNativeModel).toHaveBeenLastCalledWith(
      agent.id,
      nativeModel,
      expect.objectContaining({ files: undefined })
    )
  })
})
