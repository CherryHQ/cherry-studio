import { mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import { codeCliForLocalAgent } from '@renderer/utils/agent/codeCliForLocalAgent'
import { LOCAL_AGENT_PRESETS } from '@shared/ai/localAgent'
import { CodeCli } from '@shared/types/codeCli'
import { getCliConfigTargets } from '@shared/utils/cliConfig'

import { LocalAgentCliConfig } from '../components/LocalAgentCliConfig'
import { ManagedLocalAgentDetails } from '../components/ManagedLocalAgentDetails'

const binaries = vi.hoisted(() => ({ remove: vi.fn(), upgrade: vi.fn() }))
vi.mock('@renderer/components/LazyCodeEditor', () => ({
  LazyCodeEditor: ({ value }: { value: string }) => <textarea aria-label="config" value={value} readOnly />
}))
vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() }, useIpcOn: vi.fn() }))
vi.mock('@renderer/hooks/useMiniAppPopup', () => ({ useMiniAppPopup: () => ({ openSmartMiniApp: vi.fn() }) }))
vi.mock('@renderer/hooks/useApiGatewayProvider', () => ({ useApiGatewayProvider: () => null }))
vi.mock('../hooks/useAvailableTerminals', () => ({ useAvailableTerminals: () => [] }))
vi.mock('../hooks/useBinaryActions', () => ({
  useBinaryActions: () => ({
    install: vi.fn(),
    upgrade: binaries.upgrade,
    remove: binaries.remove,
    installingTools: new Set(),
    upgradingTools: new Set()
  })
}))
vi.mock('../hooks/useCliVersionStatuses', () => ({
  useCliVersionStatuses: () => ({
    statuses: {
      [CodeCli.DEEPSEEK_HARNESS]: { installed: true, source: 'system', applicationStatus: 'applied', canUpgrade: true },
      [CodeCli.OPENCLAW]: { installed: true, source: 'system', applicationStatus: 'applied', canUpgrade: true }
    },
    resolved: true
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
  mockUseQuery.mockImplementation((path) => ({
    data: (path === '/providers' ? providers : path === '/models' ? [model] : undefined) as never,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: vi.fn().mockResolvedValue(undefined),
    mutate: vi.fn()
  }))
  binaries.remove.mockResolvedValue(true)
  vi.mocked(ipcApi.request).mockImplementation(
    async (route) =>
      (route === 'deepseek_harness.start'
        ? { success: true, url: 'http://127.0.0.1:43123' }
        : { success: true }) as never
  )
})

describe('managed local Agent details', () => {
  it('provides a native file editor for every preset with persistent configuration', () => {
    const missing = LOCAL_AGENT_PRESETS.filter((p) => p.id !== 'deepagents')
      .filter((p) => !getCliConfigTargets(codeCliForLocalAgent(p.id) ?? p.id).length)
      .map((p) => p.id)
    expect(missing).toEqual([])
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
