import { mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import { CodeCli } from '@shared/types/codeCli'

import { CodeCliConfiguration } from '../components/CodeCliConfiguration'

const binaries = vi.hoisted(() => ({ remove: vi.fn(), upgrade: vi.fn() }))
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

function configured(tool: CodeCli) {
  mockPreferenceState.set('feature.code_cli.configs', {
    [tool]: {
      current: 'deepseek',
      providers: { deepseek: { modelId, config: { agentPreset: 'code', permissionMode: 'read-only' } } }
    }
  })
}

describe('CLI-only Agent details', () => {
  it.each([CodeCli.DEEPSEEK_HARNESS, CodeCli.OPENCLAW])(
    'selects a model directly for %s without launching it',
    async (tool) => {
      render(<CodeCliConfiguration initialTool={tool} embedded />)
      const button = await screen.findByRole('button', { name: 'DeepSeek Chat' })
      await userEvent.click(button)
      await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'))
      expect(mockPreferenceState.get('feature.code_cli.configs')[tool]).toMatchObject({
        current: 'deepseek',
        providers: { deepseek: { modelId } }
      })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '跟随 CLI' })).not.toBeInTheDocument()
      expect(vi.mocked(ipcApi.request).mock.calls.some(([route]) => route.endsWith('.start'))).toBe(false)
    }
  )

  it('launches DSH with the selected model and saved tool settings', async () => {
    configured(CodeCli.DEEPSEEK_HARNESS)
    render(<CodeCliConfiguration initialTool={CodeCli.DEEPSEEK_HARNESS} embedded />)
    await userEvent.click(screen.getByRole('button', { name: '启动' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('deepseek_harness.start', {
        mode: 'direct',
        uniqueModelId: modelId,
        agentPreset: 'code',
        permissionMode: 'read-only'
      })
    )
  })

  it.each([
    [CodeCli.DEEPSEEK_HARNESS, 'feature.deepseek_harness.status'],
    [CodeCli.OPENCLAW, 'feature.openclaw.gateway_status']
  ] as const)('locks model and config changes while %s runs', async (tool, key) => {
    configured(tool)
    MockUseCacheUtils.setSharedCacheValue(
      key,
      tool === CodeCli.OPENCLAW ? 'running' : { status: 'running', url: 'http://127.0.0.1:43123' }
    )
    render(<CodeCliConfiguration initialTool={tool} embedded />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'DeepSeek Chat' })).toBeDisabled())
    expect(screen.getByRole('button', { name: '高级设置' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '升级' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '停止' })).toBeEnabled()
  })

  it('stops DSH before uninstalling and preserves its saved settings', async () => {
    configured(CodeCli.DEEPSEEK_HARNESS)
    const operations: string[] = []
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'deepseek_harness.stop') operations.push('stop')
      return { success: true } as never
    })
    binaries.remove.mockImplementation(async () => {
      operations.push('remove')
      return true
    })
    render(<CodeCliConfiguration initialTool={CodeCli.DEEPSEEK_HARNESS} embedded />)
    await userEvent.click(screen.getByRole('button', { name: '卸载' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /卸载|删除|确认/ }))
    await waitFor(() => expect(operations).toEqual(['stop', 'remove']))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockPreferenceState.get('feature.code_cli.configs')[CodeCli.DEEPSEEK_HARNESS]).toMatchObject({
      current: null,
      providers: { deepseek: { modelId } }
    })
  })
})
