import { webcrypto } from 'node:crypto'

import { mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import type { LocalAgentSessionInfo } from '@shared/ai/localAgent'
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
    localRuntime: { presetId: 'opencode', enabled: true, args: [], env: {}, nativeModel: 'first' }
  }
}
const info: LocalAgentSessionInfo = {
  modelSelection: 'selectable',
  activeModel: { id: 'first' },
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
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-index') ? 42 : 320
  })
  updateNativeModel.mockReset()
  vi.mocked(ipcApi.request).mockImplementation(
    async () => ({ files: [{ target: 'opencode-config', path: '/test/opencode.json', content: null }] }) as never
  )
})

afterEach(() => vi.restoreAllMocks())

describe('local agent model persistence', () => {
  it('loads the Antigravity catalog on open and selects a model for the first turn', async () => {
    const user = userEvent.setup()
    const antigravity = {
      ...agent,
      configuration: { localRuntime: { ...agent.configuration!.localRuntime!, presetId: 'antigravity-acp' } }
    } satisfies AgentEntity
    const request = vi.mocked(ipcApi.request)
    request.mockResolvedValueOnce({ models: info.models })
    updateNativeModel.mockResolvedValueOnce(antigravity)

    render(<LocalAgentModelControl agent={antigravity} sessionId="session" disabled={false} side="top" />)
    expect(request).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '选择模型' }))
    await user.click(await screen.findByRole('option', { name: 'Second' }))
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Second' })).not.toBeInTheDocument())
    expect(updateNativeModel).toHaveBeenCalledWith(antigravity.id, 'second')
  })

  it.each(['disconnected', 'current-only', 'selectable'] as const)(
    'offers configured Qwen models while %s',
    async (status) => {
      const user = userEvent.setup()
      const qwenAgent = {
        ...agent,
        configuration: {
          localRuntime: {
            ...agent.configuration!.localRuntime!,
            presetId: 'qwen',
            nativeModel: 'first',
            sourceModelId: 'test::first',
            sourceModelViaGateway: true
          }
        }
      } satisfies AgentEntity
      catalog.providers = [{ id: 'test', isEnabled: true }]
      catalog.models = info.models.map(({ id, name }) => ({
        id: `test::${id}`,
        name,
        providerId: 'test',
        capabilities: [],
        endpointTypes: ['openai-chat-completions'],
        isEnabled: true,
        supportsStreaming: true,
        isHidden: false
      }))
      const activeModel = { id: 'first(openai)', name: 'First' }
      const nativeModel = { id: 'native', name: 'Native model' }
      vi.mocked(ipcApi.request).mockResolvedValue({
        models: [activeModel, nativeModel]
      })
      try {
        render(
          <LocalAgentModelControl
            agent={qwenAgent}
            sessionId="session"
            info={
              status === 'disconnected'
                ? undefined
                : {
                    ...info,
                    models: status === 'selectable' ? [activeModel, nativeModel] : [activeModel],
                    activeModel,
                    modelSelection: status
                  }
            }
            disabled={false}
            side="top"
          />
        )
        await user.click(screen.getByRole('button', { name: '选择模型' }))
        expect(await screen.findByRole('option', { name: 'Second' })).not.toHaveAttribute('aria-disabled', 'true')
        expect(await screen.findByRole('option', { name: 'Native model' })).not.toHaveAttribute('aria-disabled', 'true')
        expect(screen.getByRole('option', { name: 'First' })).toHaveAttribute('aria-selected', 'true')
      } finally {
        catalog.models = []
        catalog.providers = []
      }
    }
  )

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

  it('switches a session model and keeps the Agent default preference', async () => {
    const user = userEvent.setup()
    const confirmed: LocalAgentSessionInfo = { ...info, activeModel: { id: 'second' } }
    const request = vi.mocked(ipcApi.request)
    request.mockRejectedValueOnce(new Error('The ACP session did not confirm the selected model'))
    request.mockResolvedValueOnce(confirmed)
    const props = {
      agent: {
        ...agent,
        configuration: { localRuntime: { ...agent.configuration!.localRuntime!, presetId: 'auggie' } }
      },
      sessionId: 'session',
      disabled: false,
      side: 'bottom'
    } as const
    const { rerender } = render(<LocalAgentModelControl {...props} info={info} />)
    const trigger = screen.getByRole('button', { name: '选择模型' })
    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: 'Second' }))
    expect(trigger).toHaveTextContent('First')
    await user.click(screen.getByRole('option', { name: 'Second' }))
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Second' })).not.toBeInTheDocument())
    expect(request).toHaveBeenLastCalledWith('ai.local_agents.select_session_model', {
      sessionId: 'session',
      modelId: 'second'
    })
    expect(updateNativeModel).not.toHaveBeenCalled()
    rerender(<LocalAgentModelControl {...props} info={confirmed} />)
    expect(trigger).toHaveTextContent('Second')
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

  it('keeps a single offered model visible without allowing a switch', async () => {
    const user = userEvent.setup()
    render(
      <LocalAgentModelControl
        agent={agent}
        info={{ ...info, models: [info.models[0]], modelSelection: 'current-only' }}
        sessionId="session"
        disabled={false}
        side="bottom"
      />
    )
    await user.click(screen.getByRole('button', { name: '选择模型' }))
    expect(screen.getByText('当前会话仅提供正在使用的模型。')).toBeVisible()
    expect(screen.getByRole('option', { name: 'First' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('keeps model configuration out of the input model picker', async () => {
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
    expect(screen.queryByRole('button', { name: '智能体配置' })).not.toBeInTheDocument()
  })

  it.each([
    ['Second', 'second'],
    ['沿用原生配置', undefined]
  ] as const)('retains the Codex model on failure and allows retry: %s', async (label, nativeModel) => {
    const user = userEvent.setup()
    const codexAgent = {
      ...agent,
      configuration: { localRuntime: { ...agent.configuration!.localRuntime!, presetId: 'codex' } }
    }
    updateNativeModel.mockResolvedValueOnce(undefined).mockResolvedValueOnce(codexAgent)
    render(<LocalAgentModelControl agent={codexAgent} info={info} disabled={false} side="top" />)
    await user.click(screen.getByRole('button', { name: '选择模型' }))
    await user.click(await screen.findByText(label))
    expect(await screen.findByText(label)).toBeVisible()
    expect(screen.getByRole('button', { name: '选择模型' })).toHaveTextContent('First')
    await user.click(screen.getByText(label))
    await waitFor(() => expect(screen.queryByText(label)).not.toBeInTheDocument())
    expect(updateNativeModel).toHaveBeenLastCalledWith(codexAgent.id, nativeModel)
  })
})
