import { mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import { codeCliForLocalAgent } from '@renderer/utils/agent/codeCliForLocalAgent'
import { LOCAL_AGENT_PRESETS, LOCAL_CLI_AGENT_PRESETS } from '@shared/ai/localAgent'
import { CodeCli } from '@shared/types/codeCli'
import { getCliConfigTargets } from '@shared/utils/cliConfig'

import { LocalAgentCliConfig } from '../components/LocalAgentCliConfig'
import { ManagedLocalAgentDetails } from '../components/ManagedLocalAgentDetails'

vi.mock('@renderer/components/LazyCodeEditor', () => ({
  LazyCodeEditor: ({ value }: { value: string }) => <textarea aria-label="config" value={value} readOnly />
}))
vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() }, useIpcOn: vi.fn() }))
vi.mock('@renderer/hooks/useMiniAppPopup', () => ({ useMiniAppPopup: () => ({ openSmartMiniApp: vi.fn() }) }))
vi.mock('@renderer/hooks/useApiGateway', () => ({
  useApiGateway: () => ({
    apiGatewayConfig: { host: '127.0.0.1', port: 23333, apiKey: null },
    apiGatewayRunning: false,
    startApiGateway: vi.fn()
  })
}))
const modelId = 'deepseek::deepseek-chat' as const
const model = {
  id: modelId,
  providerId: 'deepseek',
  apiModelId: 'deepseek-chat',
  name: 'DeepSeek Chat',
  isEnabled: true,
  endpointTypes: ['openai-chat-completions'],
  capabilities: [],
  supportsStreaming: true,
  isHidden: false
}

beforeEach(() => {
  vi.clearAllMocks()
  MockUseCacheUtils.resetMocks()
  mockPreferenceState.set('feature.code_cli.configs', {})
  const providers = [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      isEnabled: true,
      authType: 'api-key',
      authOptional: true,
      apiKeys: [],
      endpointConfigs: {
        'anthropic-messages': { baseUrl: 'https://api.deepseek.com/anthropic' },
        'openai-chat-completions': { baseUrl: 'https://api.deepseek.com' }
      }
    }
  ]
  providers.push({ ...providers[0], id: 'team-gateway', name: 'Team Gateway' })
  const models = [
    model,
    {
      ...model,
      providerId: 'team-gateway',
      apiModelId: 'vendor/deepseek-chat',
      id: 'team-gateway::vendor/deepseek-chat'
    },
    { ...model, id: 'deepseek::deepseek-pro', apiModelId: 'deepseek-pro', name: 'DeepSeek Pro', group: 'My favorites' }
  ]
  mockUseQuery.mockImplementation((path) => ({
    data: (path === '/providers' ? providers : path === '/models' ? models : undefined) as never,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: vi.fn().mockResolvedValue(undefined),
    mutate: vi.fn()
  }))
  vi.mocked(ipcApi.request).mockImplementation(
    async (route) =>
      (route === 'deepseek_harness.start'
        ? { success: true, url: 'http://127.0.0.1:43123' }
        : { success: true }) as never
  )
})

describe('managed local Agent details', () => {
  afterEach(() => vi.restoreAllMocks())

  it('provides a native file editor for every preset with persistent configuration', () => {
    const missing = LOCAL_CLI_AGENT_PRESETS.filter((p) => p.id !== 'deepagents')
      .filter((p) => !getCliConfigTargets(codeCliForLocalAgent(p.id) ?? p.id).length)
      .map((p) => p.id)
    expect(missing).toEqual([])
  })

  it('groups gateway models by provider', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(320)
    const tool = CodeCli.DEEPSEEK_HARNESS
    render(
      <ManagedLocalAgentDetails
        tool={tool}
        preset={LOCAL_AGENT_PRESETS.find((preset) => preset.id === tool)}
        detection={{ presetId: tool, path: '/usr/local/bin/tool', source: 'system' }}
        installing={false}
        onInstall={vi.fn()}
        onNavigate={vi.fn()}
        onCancelNavigation={vi.fn()}
        onSaved={vi.fn()}
      />
    )
    const list = within(screen.getByRole('region', { name: '模型' }))
    const deepSeek = list.getByRole('button', { name: '深度求索', expanded: true })
    expect(list.getAllByRole('button', { name: /DeepSeek Chat/ })).toHaveLength(2)
    await userEvent.click(deepSeek)
    expect(list.getByRole('button', { name: 'Team Gateway', expanded: true })).toBeVisible()
    expect(list.getAllByRole('button', { name: /DeepSeek Chat/ })).toHaveLength(1)
    expect(list.queryByRole('button', { name: /DeepSeek Pro/ })).toBeNull()
  })

  it.each([CodeCli.OPENCLAW, CodeCli.DEEPSEEK_HARNESS] as const)(
    'opens %s native files without requiring a selected Cherry model',
    async (tool) => {
      const target = tool === CodeCli.OPENCLAW ? 'openclaw-config' : 'dsh-settings'
      const path = tool === CodeCli.OPENCLAW ? '/home/test/.openclaw/openclaw.json' : '/home/test/.dsh/settings.yaml'
      const content = tool === CodeCli.OPENCLAW ? '{"gateway":{"port":18790}}' : 'agent-presets:\n  default: standard\n'
      vi.mocked(ipcApi.request).mockImplementation(
        async (route) =>
          (route === 'code_cli.read_config'
            ? {
                files: [
                  {
                    target,
                    path,
                    content
                  }
                ]
              }
            : { success: true }) as never
      )
      render(
        <ManagedLocalAgentDetails
          tool={tool}
          preset={LOCAL_AGENT_PRESETS.find((preset) => preset.id === tool)}
          detection={{ presetId: tool, path: '/usr/local/bin/tool', source: 'system' }}
          cliConfigEntry={<LocalAgentCliConfig tool={tool} />}
          installing={false}
          onInstall={vi.fn()}
          onNavigate={vi.fn()}
          onCancelNavigation={vi.fn()}
          onSaved={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: 'CLI 配置文件' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText(path)).toBeVisible()
      expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
    }
  )
})
