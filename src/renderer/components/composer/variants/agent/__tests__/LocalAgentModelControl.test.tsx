import { webcrypto } from 'node:crypto'

import { mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import type { AgentEntity } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import { CLI_API_GATEWAY_PROVIDER_ID, CodeCli } from '@shared/types/codeCli'

import { AgentConversationControls } from '../AgentConversationControls'
import { LocalAgentModelControl } from '../LocalAgentModelControl'

const catalog = vi.hoisted(() => ({ models: [] as Model[], providers: [] as { id: string; isEnabled: boolean }[] }))
vi.mock('@renderer/hooks/useModel', () => ({ useModels: () => ({ models: catalog.models }) }))
vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: catalog.providers }),
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

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  vi.stubGlobal('crypto', webcrypto)
  HTMLElement.prototype.scrollIntoView = vi.fn()
  updateNativeModel.mockReset()
  vi.mocked(ipcApi.request).mockImplementation(
    async () => ({ files: [{ target: 'opencode-config', path: '/test/opencode.json', content: null }] }) as never
  )
})

describe('local agent model persistence', () => {
  it('shows and changes the saved DeepSeek Harness gateway model from a new chat', async () => {
    const user = userEvent.setup()
    const model = {
      providerId: 'test',
      capabilities: [],
      endpointTypes: ['openai-chat-completions'],
      isEnabled: true,
      supportsStreaming: true,
      isHidden: false
    } satisfies Omit<Model, 'id' | 'name'>
    const first: Model = { ...model, id: 'test::first', name: 'First gateway model' }
    const second: Model = { ...model, id: 'test::second', name: 'Second gateway model' }
    const saved = (modelId: Model['id']) => ({
      [CodeCli.DEEPSEEK_HARNESS]: {
        current: CLI_API_GATEWAY_PROVIDER_ID,
        providers: { [CLI_API_GATEWAY_PROVIDER_ID]: { modelId } }
      }
    })
    const config = { ...agent.configuration!.localRuntime!, presetId: CodeCli.DEEPSEEK_HARNESS, nativeModel: undefined }
    const props = {
      agent: { ...agent, configuration: { localRuntime: config } },
      disabled: false,
      side: 'bottom'
    } as const
    const key = 'feature.code_cli.configs'
    const previous = mockPreferenceState.get(key)
    mockPreferenceState.set(key, saved(first.id))
    catalog.models = [first, second]
    catalog.providers = [{ id: 'test', isEnabled: true }]
    vi.mocked(ipcApi.request).mockImplementation(async (route, input) => {
      if (route !== 'deepseek_harness.select_gateway_model') throw new Error(`Unexpected route: ${route}`)
      mockPreferenceState.set(key, saved((input as { uniqueModelId: Model['id'] }).uniqueModelId))
      return undefined as never
    })

    try {
      const { rerender } = render(<LocalAgentModelControl {...props} />)
      const trigger = screen.getByRole('button', { name: '选择模型' })
      expect(trigger).toHaveTextContent(first.name)
      await user.click(trigger)
      expect(screen.getByRole('option', { name: first.name })).toHaveAttribute('aria-selected', 'true')
      await user.click(screen.getByRole('option', { name: second.name }))
      await waitFor(() => expect(screen.queryByRole('option', { name: second.name })).not.toBeInTheDocument())
      rerender(<LocalAgentModelControl {...props} />)
      expect(trigger).toHaveTextContent(second.name)

      rerender(
        <LocalAgentModelControl
          {...props}
          info={{ ...info, activeModel: { id: '["cherry-studio-codemate-gateway","test:first"]', name: 'test:first' } }}
        />
      )
      expect(trigger).toHaveTextContent(first.name)
      await user.click(trigger)
      expect(screen.getByRole('option', { name: first.name })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('option', { name: second.name })).toHaveAttribute('aria-disabled', 'true')
    } finally {
      mockPreferenceState.set(key, previous)
      catalog.models = []
      catalog.providers = []
    }
  })

  it('respects the common model-editing permission for local agents', () => {
    const props = {
      agent,
      localInfo: info,
      selectAgentLabel: '选择智能体',
      selectModelLabel: '选择模型',
      selectWorkspaceLabel: '选择工作目录',
      shouldAutoSelectCreatedAgent: false,
      side: 'bottom' as const,
      agentTriggerMode: 'edit' as const,
      onAgentChange: () => {},
      onModelSelect: () => {}
    }
    const { rerender } = render(<AgentConversationControls {...props} canChangeModel={false} />)
    expect(screen.getByRole('button', { name: '选择模型' })).toBeDisabled()
    rerender(<AgentConversationControls {...props} canChangeModel />)
    expect(screen.getByRole('button', { name: '选择模型' })).toBeEnabled()
  })

  it.each([
    ['cursor', 'Cursor CLI 当前不支持自定义服务商模型。'],
    ['auggie', '暂未适配此智能体的服务商模型。']
  ])('explains model switching restrictions for %s without changing configuration', async (presetId, reason) => {
    const user = userEvent.setup()
    render(
      <LocalAgentModelControl
        agent={{
          ...agent,
          configuration: { localRuntime: { ...agent.configuration!.localRuntime!, presetId } }
        }}
        info={info}
        disabled={false}
        side="bottom"
      />
    )
    await user.click(screen.getByRole('button', { name: '选择模型' }))
    const native = screen.getByRole('tab', { name: '智能体模型' })
    const gateway = screen.getByRole('tab', { name: '统一网关' })
    expect(native).toBeEnabled()
    expect(native).toHaveAttribute('aria-selected', 'true')
    expect(gateway).toBeDisabled()
    expect(screen.getByRole('option', { name: 'Second' })).toHaveAttribute('aria-disabled', 'true')
    await user.hover(native.parentElement!)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('暂未适配此智能体的默认模型切换。')
    await user.hover(gateway.parentElement!)
    expect(await screen.findByRole('tooltip', { name: reason })).toBeVisible()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(updateNativeModel).not.toHaveBeenCalled()
  })

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
    ['官方订阅', undefined]
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
