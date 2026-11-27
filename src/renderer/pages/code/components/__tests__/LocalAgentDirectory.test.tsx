import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TabIdContext, TabsContext, type Tab, type TabsContextValue } from '@renderer/hooks/tab'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { LocalAgentConfiguration, LocalAgentDetection } from '@shared/ai/localAgent'
import type { AgentEntity } from '@shared/data/api/schemas/agents'

import { LocalAgentDirectory } from '../LocalAgentDirectory'
import { clearLocalAgentAuthStatusCache } from '../LocalAgentLogin'

function localAgent(
  name: string,
  configuration: Partial<LocalAgentConfiguration> = {},
  id = 'test-local'
): AgentEntity {
  return {
    id,
    name,
    type: 'local',
    model: null,
    modelName: null,
    orderKey: 'a0',
    createdAt: '',
    updatedAt: '',
    localRuntime: { providerId: `${id}-provider`, enabled: true, args: [], env: {}, ...configuration }
  }
}

function publishAgent(agent: AgentEntity) {
  MockUseDataApiUtils.mockQueryData('/agents', { items: [agent], total: 1, page: 1 })
}

const navigation = vi.hoisted(() => ({ search: { id: 'claude' }, navigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => navigation.search,
  useNavigate: () => navigation.navigate
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() }, useIpcOn: vi.fn() }))
vi.mock('@renderer/hooks/useModel', () => ({ useModels: () => ({ models: [] }) }))
vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [] }),
  getProviderDisplayName: (provider: { name: string }) => provider.name
}))
vi.unmock('@cherrystudio/ui')

beforeEach(() => {
  clearLocalAgentAuthStatusCache()
  mockPreferenceState.set('feature.code_cli.configs', {})
  MockUseCacheUtils.resetMocks()
  MockUseDataApiUtils.resetMocks()
  MockUseDataApiUtils.mockQueryData('/agents', { items: [], total: 0, page: 1 })
  navigation.search = { id: 'claude' }
  navigation.navigate.mockImplementation(({ search }: { search: { id: string } }) => {
    navigation.search = search
    return Promise.resolve()
  })
  vi.mocked(ipcApi.request).mockImplementation(
    async (route) =>
      (route === 'file.select_folder'
        ? '/test/project'
        : route === 'code_cli.get_available_terminals'
          ? []
          : route === 'ai.local_agents.detect'
            ? [{ presetId: 'claude', path: '/usr/local/bin/claude' }]
            : { models: [] }) as never
  )
})

afterEach(() => vi.useRealTimers())

describe('local agent settings navigation', () => {
  it('shows the Qoder edition when an earlier default name was saved', () => {
    publishAgent(localAgent('Qoder', { presetId: 'qoder' }))
    render(<LocalAgentDirectory />)
    expect(screen.getByText('Qoder')).toBeVisible()
    expect(screen.getByText('Qoder CN')).toBeVisible()
  })

  it('runs TRAE terminal login even when ACP advertises an enterprise PAT method', async () => {
    navigation.search = { id: 'trae' }
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') return [{ presetId: 'trae', path: '/test/traecli' }] as never
      if (route === 'ai.local_agents.read_account') return { status: 'signed-out' }
      if (route === 'ai.local_agents.open_terminal') return { success: true } as never
      return {
        models: [],
        authMethods: [{ id: 'personal-access-token', name: 'Sign in with Personal Access Token', type: 'agent' }]
      } as never
    })

    render(<LocalAgentDirectory />)
    await userEvent.click(await screen.findByRole('button', { name: '登录' }))

    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith(
        'ai.local_agents.open_terminal',
        expect.objectContaining({ presetId: 'trae', login: true })
      )
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('omits subscription usage from the signed-in Codex settings menu', async () => {
    navigation.search = { id: 'codex' }
    publishAgent(localAgent('Codex', { presetId: 'codex' }))
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') return [{ presetId: 'codex', path: '/test/codex' }] as never
      if (route === 'ai.local_agents.read_account') {
        return { status: 'signed-in', account: { displayName: 'Test account' } } as never
      }
      return { models: [] } as never
    })

    render(<LocalAgentDirectory />)
    await userEvent.click(await screen.findByRole('button', { name: '已登录' }))

    const menu = within(screen.getByRole('menu'))
    expect(menu.getByRole('menuitem', { name: '重新登录' })).toBeVisible()
    expect(menu.queryByRole('menuitem', { name: '用量' })).not.toBeInTheDocument()
  })

  it.each([
    { presetId: 'codex', optionLabel: /ChatGPT 账号/, methodId: 'codex-browser' },
    { presetId: 'pi-acp', methodId: 'pi-browser' }
  ])('starts in-app browser sign-in from the installed $presetId card', async ({ presetId, optionLabel, methodId }) => {
    navigation.search = { id: presetId }
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') return [{ presetId, path: '/test/cli' }] as never
      return { models: [], authMethods: [], success: true } as never
    })
    render(<LocalAgentDirectory />)
    await userEvent.click(await screen.findByRole('button', { name: '登录' }))
    const dialog = within(screen.getByRole('dialog'))
    if (presetId === 'pi-acp') {
      await userEvent.type(dialog.getByRole('combobox'), 'openai-codex')
      await userEvent.click(dialog.getByRole('button', { name: '登录' }))
    } else if (optionLabel) {
      await userEvent.click(dialog.getByRole('button', { name: optionLabel }))
    }
    expect(ipcApi.request).toHaveBeenCalledWith(
      'ai.local_agents.authenticate',
      expect.objectContaining({
        methodId,
        ...(presetId === 'pi-acp' ? { provider: 'openai-codex' } : {}),
        config: expect.objectContaining({ presetId })
      })
    )
    expect(ipcApi.request).not.toHaveBeenCalledWith('ai.local_agents.open_terminal', expect.anything())
  })

  it('launches terminal auth login and reports native signed-in status for opencode', async () => {
    navigation.search = { id: 'opencode' }
    let nativeStatus: 'signed-out' | 'signed-in' = 'signed-out'
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') return [{ presetId: 'opencode', path: '/test/opencode' }] as never
      if (route === 'ai.local_agents.models')
        return {
          models: [{ id: 'opencode/model', name: 'Native test model' }],
          authMethods: [{ id: 'opencode-login', name: 'Login with opencode', type: 'agent' }]
        } as never
      if (route === 'ai.local_agents.read_account') return { status: nativeStatus }
      if (route === 'ai.local_agents.open_terminal') return { success: true } as never
      return { ok: true, protocolInfo: { authMethods: [{ id: 'opencode-login', type: 'agent' }] } } as never
    })

    render(<LocalAgentDirectory />)
    await userEvent.click(await screen.findByRole('button', { name: '登录' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('button', { name: /OpenCode Console/ })).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: /在终端中配置 OpenCode Go 或其他服务/ }))

    expect(ipcApi.request).toHaveBeenCalledWith(
      'ai.local_agents.open_terminal',
      expect.objectContaining({ presetId: 'opencode', login: true })
    )
    expect(ipcApi.request).not.toHaveBeenCalledWith('ai.local_agents.authenticate', expect.anything())

    nativeStatus = 'signed-in'
    fireEvent(window, new Event('focus'))
    const signedInButton = await screen.findByRole('button', { name: '已登录' })
    expect(signedInButton).toBeVisible()
    vi.mocked(ipcApi.request).mockClear()
    await userEvent.click(signedInButton)
    expect(ipcApi.request).not.toHaveBeenCalledWith('ai.local_agents.open_terminal', expect.anything())
  })

  it('recognizes an existing Antigravity session and clears its status after authentication is rejected', async () => {
    navigation.search = { id: 'antigravity-acp' }
    const methods = [{ id: 'oauth-personal', name: 'Google', type: 'agent' }]
    let failure: string | undefined
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') return [{ presetId: 'antigravity-acp', path: '/test/agent' }] as never
      if (route === 'ai.local_agents.models') {
        if (failure) throw new Error(failure)
        return { models: [{ id: 'gemini', name: 'Gemini' }], authMethods: methods } as never
      }
      if (route === 'ai.local_agents.read_account') return { status: 'unsupported' }
      return { protocolInfo: { authMethods: methods } } as never
    })
    render(<LocalAgentDirectory />)
    expect(await screen.findByRole('button', { name: '已登录' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '已登录' }))
    expect(screen.queryByRole('heading', { name: /重新登录/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: '重新登录' }))
    expect(screen.getByRole('heading', { name: /重新登录/ })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    failure = 'Authentication required'
    fireEvent(window, new Event('focus'))
    expect(await screen.findByRole('button', { name: '登录' })).toBeVisible()
    failure = 'Network offline'
    fireEvent(window, new Event('focus'))
    await waitFor(() => expect(screen.getByRole('button', { name: '登录' })).toBeEnabled())
    expect(screen.queryByRole('button', { name: /已登录/ })).not.toBeInTheDocument()
    expect(ipcApi.request).not.toHaveBeenCalledWith('ai.local_agents.authenticate', expect.anything())
  })

  it('closes the sign-in dialog and reports a model refresh failure on the card after successful OAuth', async () => {
    navigation.search = { id: 'antigravity-acp' }
    let authenticated = false
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') return [{ presetId: 'antigravity-acp', path: '/test/agent' }] as never
      if (route === 'ai.local_agents.authenticate') {
        authenticated = true
        return undefined
      }
      if (route === 'ai.local_agents.models' && authenticated) throw new Error('catalog offline')
      if (route === 'ai.local_agents.models') throw new Error('Authentication required')
      return { protocolInfo: { authMethods: [{ id: 'oauth-personal', name: 'Google', type: 'agent' }] } } as never
    })
    render(<LocalAgentDirectory />)
    await userEvent.click(await screen.findByRole('button', { name: '登录' }))
    const signInMethods = within(await screen.findByRole('dialog'))
    await userEvent.click(await signInMethods.findByRole('button', { name: 'Google' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText(/拉取模型失败/)).toBeVisible()
    expect(await screen.findByText('catalog offline')).toBeVisible()
    expect(screen.getByRole('button', { name: '已登录' })).toBeVisible()
    expect(toast.success).toHaveBeenCalledWith('已登录')
  })

  it('signs into the selected saved Agent without issuing a separate credentials patch', async () => {
    navigation.search = { id: 'antigravity-acp' }
    const agent = localAgent('Google Antigravity', {
      presetId: 'antigravity-acp',
      nativeModel: 'existing-model',
      env: { KEEP: 'value' }
    })
    publishAgent(agent)
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') return [{ presetId: 'antigravity-acp', path: '/test/agent' }] as never
      if (route === 'ai.local_agents.read_account') return { status: 'unsupported' }
      if (route === 'ai.local_agents.models') throw new Error('Authentication required')
      if (route === 'ai.local_agents.authenticate') return { methodId: 'gemini-api-key' }
      return {
        protocolInfo: { authMethods: [{ id: 'gemini-api-key', name: 'Gemini API key', type: 'agent' }] }
      } as never
    })
    render(<LocalAgentDirectory />)
    await userEvent.click(await screen.findByRole('button', { name: '登录' }))
    const signInChoices = within(await screen.findByRole('dialog'))
    await userEvent.click(await signInChoices.findByRole('button', { name: 'Gemini API 密钥' }))
    await userEvent.type(await screen.findByLabelText('API 密钥'), 'new-test-key')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '登录' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(ipcApi.request).toHaveBeenCalledWith(
      'ai.local_agents.authenticate',
      expect.objectContaining({
        agentId: agent.id,
        methodId: 'gemini-api-key',
        config: expect.objectContaining({ env: { KEEP: 'value', GEMINI_API_KEY: 'new-test-key' } })
      })
    )
    expect(ipcApi.request).not.toHaveBeenCalledWith('ai.local_agents.update_settings', expect.anything())
    expect(toast.success).toHaveBeenCalledWith('已登录')
  })

  it('keeps failed installation discovery quiet until the user explicitly retries', async () => {
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') throw new Error('discovery unavailable')
      return { models: [] } as never
    })
    render(<LocalAgentDirectory />)
    const retry = screen.getByRole('button', { name: '重新检测' })
    await waitFor(() => expect(retry).toBeEnabled())
    expect(toast.error).not.toHaveBeenCalled()
    await userEvent.click(retry)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Error: discovery unavailable'))
  })

  it.each([
    { status: 'missing', rows: [] },
    { status: 'uncertain', rows: [{ presetId: 'codex', source: 'none', uncertain: true as const }] }
  ])('keeps a runnable CLI available when detection returns a $status result', async ({ rows }) => {
    navigation.search = { id: 'codex' }
    let detection: LocalAgentDetection[] = [{ presetId: 'codex', source: 'system', path: '/usr/local/bin/codex' }]
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') return detection as never
      return { models: [] } as never
    })
    render(<LocalAgentDirectory />)
    expect(await screen.findByRole('button', { name: '检查连接' })).toBeEnabled()

    detection = rows
    await userEvent.click(screen.getByRole('button', { name: '重新检测' }))
    const retry = await screen.findByRole('button', { name: /^重试$/ })
    expect(screen.getByRole('button', { name: '检查连接' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^安装$/ })).not.toBeInTheDocument()

    detection = [{ presetId: 'codex', source: 'none' }]
    await userEvent.click(retry)
    expect(await screen.findByRole('button', { name: /^安装$/ })).toBeEnabled()
    expect(ipcApi.request).not.toHaveBeenCalledWith('ai.local_agents.install', expect.anything())
  })

  it('does not report a launch failure while merely reading CodeBuddy WebUI status', async () => {
    navigation.search = { id: 'codebuddy-code' }
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect')
        return [{ presetId: 'codebuddy-code', path: '/usr/local/bin/codebuddy' }] as never
      if (route === 'ai.codebuddy_web.status') throw new Error('status unavailable')
      return { models: [] } as never
    })
    render(<LocalAgentDirectory />)
    await waitFor(() => expect(ipcApi.request).toHaveBeenCalledWith('ai.codebuddy_web.status'))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each(['opencode', 'codebuddy-code'])(
    'starts %s without opening a page and opens WebUI only on request',
    async (presetId) => {
      navigation.search = { id: presetId }
      const route = presetId === 'opencode' ? 'ai.local_agents.web_start' : 'ai.codebuddy_web.start'
      const url = 'http://127.0.0.1:54321/'
      publishAgent(localAgent(presetId, { presetId }))
      vi.mocked(ipcApi.request).mockImplementation(async (method) => {
        if (method === 'ai.local_agents.detect') return [{ presetId, path: '/test/cli' }] as never
        if (method === route) return { status: 'running', owned: true, url } as never
        return { models: [] } as never
      })
      const { rerender } = render(<LocalAgentDirectory />)
      await userEvent.click(await screen.findByRole('button', { name: '启动服务' }))
      await waitFor(() => expect(ipcApi.request).toHaveBeenCalledWith(route, expect.objectContaining({ presetId })))
      expect(
        vi.mocked(ipcApi.request).mock.calls.some(([method]) => method === 'system.shell.open_external_website')
      ).toBe(false)
      if (presetId === 'opencode')
        MockUseCacheUtils.setSharedCacheValue('feature.local_agent.web_ui.status', {
          opencode: { status: 'running', url }
        })
      else
        MockUseCacheUtils.setSharedCacheValue('feature.codebuddy.web_ui.status', {
          status: 'running',
          owned: true,
          url
        })
      rerender(<LocalAgentDirectory />)
      await userEvent.click(await screen.findByRole('button', { name: '打开 WebUI' }))
      expect(ipcApi.request).toHaveBeenCalledWith('system.shell.open_external_website', expect.stringContaining(url))
      expect(vi.mocked(ipcApi.request).mock.calls.filter(([method]) => method === route)).toHaveLength(1)
    }
  )

  it.each(['opencode', 'codebuddy-code'])('reports a stop failure accurately for %s WebUI', async (presetId) => {
    navigation.search = { id: presetId }
    if (presetId === 'opencode')
      MockUseCacheUtils.setSharedCacheValue('feature.local_agent.web_ui.status', { opencode: { status: 'running' } })
    else MockUseCacheUtils.setSharedCacheValue('feature.codebuddy.web_ui.status', { status: 'running', owned: true })
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') return [{ presetId, path: '/test/cli' }] as never
      if (route === 'ai.local_agents.web_stop' || route === 'ai.codebuddy_web.stop') throw new Error('stop failed')
      return { models: [] } as never
    })
    render(<LocalAgentDirectory />)
    await userEvent.click(await screen.findByRole('button', { name: '停止服务' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('停止服务失败，请重试。'))
    expect(screen.getByRole('button', { name: '打开 WebUI' })).toBeEnabled()
  })

  it.each(['opencode', 'codebuddy-code', 'hermes'])('requires an enabled agent to start %s WebUI', async (presetId) => {
    navigation.search = { id: presetId }
    MockUseCacheUtils.setSharedCacheValue('feature.local_agent.web_ui.status', {})
    MockUseCacheUtils.setSharedCacheValue('feature.codebuddy.web_ui.status', { status: 'stopped', owned: false })
    MockUseCacheUtils.setSharedCacheValue('feature.hermes_dashboard.status', { status: 'stopped' })
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') return [{ presetId, path: '/test/cli' }] as never
      return { models: [] } as never
    })
    const { rerender } = render(<LocalAgentDirectory />)
    const start = await screen.findByRole('button', { name: '启动服务' })
    expect(start).toBeDisabled()
    await userEvent.click(start)
    expect(
      vi.mocked(ipcApi.request).mock.calls.some(([route]) => route.endsWith('.start') || route.endsWith('.web_start'))
    ).toBe(false)
    publishAgent(localAgent(presetId, { presetId }))
    rerender(<LocalAgentDirectory />)
    await waitFor(() => expect(screen.getByRole('button', { name: '启动服务' })).toBeEnabled())
  })

  it('keeps automatic authentication failures quiet and reports failures after a manual model refresh', async () => {
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') return [{ presetId: 'claude', path: '/usr/local/bin/claude' }] as never
      if (route === 'ai.local_agents.models') throw new Error('Authentication required')
      return { models: [] } as never
    })
    render(<LocalAgentDirectory />)
    await waitFor(() => expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.models', expect.anything()))
    expect(screen.getByRole('button', { name: '检查连接' })).toBeEnabled()
    expect(screen.queryByText('请先登录')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '同步模型' }))
    expect(await screen.findByText('请先登录')).toBeVisible()
  })

  it.each([true, false])(
    'shows the installed version and discovered upgrade without checking a connection (canUpgrade=%s)',
    async (canUpgrade) => {
      vi.mocked(ipcApi.request).mockImplementation(async (route, input) => {
        if (route === 'ai.local_agents.detect')
          return [{ presetId: 'claude', path: '/usr/local/bin/claude', version: '1.0.0' }] as never
        if (route === 'ai.local_agents.version') return { current: '1.0.0', latest: '2.0.0', canUpgrade } as never
        if (route === 'ai.local_agents.install') {
          expect(input).toEqual({ presetId: 'claude', targetVersion: '2.0.0' })
          return { ok: true, reused: false, path: '/usr/local/bin/claude' } as never
        }
        return { models: [] } as never
      })
      render(<LocalAgentDirectory />)
      expect(await screen.findByText('v1.0.0')).toBeInTheDocument()
      const upgradeButton = await screen.findByRole('button', { name: '更新到 v2.0.0' })
      expect(upgradeButton).toHaveTextContent('更新到 v2.0.0')
      if (!canUpgrade) {
        expect(upgradeButton).toBeDisabled()
        return
      }
      await userEvent.click(upgradeButton)
      expect(await screen.findByText(/升级成功/)).toBeInTheDocument()
    }
  )

  it('shows the incompatible Copilot installation and its available update without offering a second install', async () => {
    const path = '/usr/local/bin/copilot'
    const version = { current: '0.0.348', latest: '1.0.116', canUpgrade: false }
    MockUseCacheUtils.setCacheValue('local_agent.versions', { copilot: { path, ...version } })
    navigation.search = { id: 'copilot' }
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect')
        return [{ presetId: 'copilot', source: 'none', incompatiblePath: path, version: version.current }] as never
      if (route === 'ai.local_agents.version') return version as never
      return [] as never
    })
    render(<LocalAgentDirectory />)
    expect(await screen.findByText('v0.0.348')).toBeVisible()
    expect(screen.getByRole('button', { name: 'GitHub Copilot · 已安装的 CLI 版本不兼容' })).toBeVisible()
    expect(screen.getByText('/usr/local/bin/copilot')).toBeVisible()
    expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent('已安装的 CLI 版本不兼容')
    expect(await screen.findByRole('button', { name: '更新到 v1.0.116' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '安装' })).not.toBeInTheDocument()
  })

  it.each([false, true])('keeps navigation usable while an upgrade is pending (fails=%s)', async (fails) => {
    const user = userEvent.setup()
    let finish!: () => void
    const upgrade = new Promise<void>((resolve) => {
      finish = resolve
    })
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect')
        return [
          { presetId: 'claude', path: '/usr/local/bin/claude' },
          { presetId: 'codex', source: 'none' }
        ] as never
      if (route === 'ai.local_agents.version') return { current: '1.0.0', latest: '2.0.0', canUpgrade: true } as never
      if (route === 'ai.local_agents.install') {
        await upgrade
        if (fails) throw new Error('upgrade failed')
        return { ok: true, reused: false, path: '/usr/local/bin/claude' } as never
      }
      return { models: [] } as never
    })
    render(<LocalAgentDirectory />)
    await user.click(await screen.findByRole('button', { name: '更新到 v2.0.0' }))
    try {
      await user.click(screen.getByRole('button', { name: /^Codex ·/ }))
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Codex'))
      expect(screen.getByRole('button', { name: '安装' })).toBeEnabled()
      await user.click(screen.getByRole('button', { name: /^Claude Code ·/ }))
      const pendingButton = await screen.findByRole('button', { name: '正在升级至 v2.0.0…' })
      expect(pendingButton).toBeDisabled()
      expect(pendingButton).toHaveAttribute('aria-busy', 'true')
      await user.click(pendingButton)
      expect(
        vi.mocked(ipcApi.request).mock.calls.filter(([route]) => route === 'ai.local_agents.install')
      ).toHaveLength(1)
      await user.click(screen.getByRole('button', { name: /^Codex ·/ }))
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Codex'))
      await act(async () => {
        finish()
        await upgrade
      })
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Codex')
      await user.click(screen.getByRole('button', { name: /^Claude Code ·/ }))
      expect(await screen.findByRole('button', { name: '更新到 v2.0.0' })).toBeEnabled()
    } finally {
      finish()
    }
  })

  it('keeps connection feedback visible while hovered and restores installation status on dismissal', async () => {
    vi.mocked(ipcApi.request).mockImplementation(
      async (route) =>
        (route === 'ai.local_agents.detect'
          ? [{ presetId: 'claude', path: '/usr/local/bin/claude' }]
          : route === 'ai.local_agents.check'
            ? { ok: true, status: 'ready', version: '1.2.3' }
            : { models: [] }) as never
    )
    render(<LocalAgentDirectory />)
    const button = await screen.findByRole('button', { name: '检查连接' })
    const program = screen.getByRole('group', { name: '程序' })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    fireEvent.click(button)
    await vi.waitFor(() => expect(within(program).getByRole('status')).toHaveTextContent('1.2.3'))
    fireEvent.mouseEnter(program)
    void act(() => vi.advanceTimersByTime(4200))
    expect(within(program).getByRole('status')).toHaveTextContent('1.2.3')
    fireEvent.mouseLeave(program)
    void act(() => vi.advanceTimersByTime(4200))
    expect(within(program).getByRole('status')).toHaveTextContent('已安装')
  })

  it('can enable Cursor and check its SDK connection on a machine without agent CLIs', async () => {
    navigation.search = { id: 'cursor' }
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') return [] as never
      if (route === 'ai.local_agents.read_account') return { status: 'signed-out' }
      if (route === 'ai.local_agents.check') return { ok: true, status: 'ready' } as never
      return { models: [] } as never
    })
    render(<LocalAgentDirectory />)
    expect(await screen.findByRole('switch', { name: '启用此智能体' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^安装$/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '检查连接' }))
    await screen.findByText('已连接')
    expect(ipcApi.request).toHaveBeenCalledWith(
      'ai.local_agents.check',
      expect.objectContaining({ presetId: 'cursor' })
    )
  })

  it('offers a system installation after a legacy Agent fails its protocol check', async () => {
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect')
        return [{ presetId: 'claude', source: 'mise', path: '/legacy/claude' }] as never
      if (route === 'ai.local_agents.check')
        return { ok: false, status: 'incompatible', error: 'Method not found' } as never
      if (route === 'ai.local_agents.install') return { ok: true, path: '/user/bin/claude' } as never
      return { models: [] } as never
    })
    render(<LocalAgentDirectory />)
    fireEvent.click(await screen.findByRole('button', { name: '检查连接' }))
    fireEvent.click(await screen.findByRole('button', { name: /^安装$/ }))
    await screen.findByText(/\/user\/bin\/claude/)
    expect(ipcApi.request).toHaveBeenCalledWith(
      'ai.local_agents.install',
      expect.objectContaining({ presetId: 'claude', systemOnly: true })
    )
  })

  it.each(['failed', 'authentication-required'])('keeps unsuccessful check feedback visible: %s', async (status) => {
    vi.mocked(ipcApi.request).mockImplementation(
      async (route) =>
        (route === 'ai.local_agents.detect'
          ? [{ presetId: 'claude', path: '/usr/local/bin/claude' }]
          : route === 'ai.local_agents.check'
            ? { ok: false, status, error: 'Agent unavailable' }
            : { models: [] }) as never
    )
    render(<LocalAgentDirectory />)
    const button = await screen.findByRole('button', { name: '检查连接' })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    fireEvent.click(button)
    const program = screen.getByRole('group', { name: '程序' })
    await vi.waitFor(() =>
      expect(within(program).getByRole('status')).toHaveTextContent(status === 'failed' ? '连接失败' : '需要登录')
    )
    void act(() => vi.advanceTimersByTime(4200))
    expect(within(program).getByRole('status')).toHaveTextContent(status === 'failed' ? '连接失败' : '需要登录')
    expect(within(program).getByRole('button', { name: '检查连接' })).toBeEnabled()
  })

  it('confirms both program paths and reports the components left after partial uninstall', async () => {
    const user = userEvent.setup()
    navigation.search = { id: 'pi-acp' }
    const components = [
      { executable: 'pi-acp', path: '/test/pi-acp' },
      { executable: 'pi', path: '/test/pi' }
    ]
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') return [{ presetId: 'pi-acp', path: '/test/pi-acp' }] as never
      if (route === 'ai.local_agents.uninstall_components') return components
      if (route === 'ai.local_agents.uninstall')
        return { ok: false, reason: 'partial', removed: ['pi-acp'], remaining: ['pi'] }
      return { models: [] } as never
    })
    vi.mocked(popup.confirm).mockResolvedValueOnce(true)
    render(<LocalAgentDirectory />)
    await user.click(await screen.findByRole('button', { name: '高级设置' }))
    await user.click(screen.getByRole('button', { name: '卸载' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.uninstall', {
        presetId: 'pi-acp',
        expectedPath: '/test/pi-acp',
        expectedComponents: components
      })
    )
    const confirmation = vi.mocked(popup.confirm).mock.calls.at(-1)![0]
    const content = render(<>{confirmation.content}</>)
    expect(within(content.container).getByText(/\/test\/pi-acp/)).toBeVisible()
    expect(within(content.container).getByText(/\/test\/pi$/)).toBeVisible()
    expect(screen.getAllByText(/已卸载：pi-acp/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/未完成卸载：pi/).length).toBeGreaterThan(0)
  })

  it('discards the advanced settings draft before reopening', async () => {
    const user = userEvent.setup()
    render(<LocalAgentDirectory />)
    await user.click(screen.getByRole('button', { name: '高级设置' }))
    await user.type(screen.getByRole('textbox', { name: /可执行程序/ }), '/tmp/temporary-agent')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '高级设置' }))
    expect(screen.getByRole('textbox', { name: /可执行程序/ })).toHaveValue('')
  })

  it('opens an installed native CLI without requiring ACP sign-in or enabling the agent', async () => {
    const user = userEvent.setup()
    render(<LocalAgentDirectory />)
    await user.click(await screen.findByRole('button', { name: '在终端打开命令行' }))
    expect(ipcApi.request).not.toHaveBeenCalledWith('ai.local_agents.open_terminal', expect.anything())
    await user.click(screen.getByRole('button', { name: '选择文件夹' }))
    await user.click(screen.getByRole('button', { name: '启动' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.open_terminal', {
        presetId: 'claude',
        enabled: false,
        args: [],
        env: {},
        directory: '/test/project'
      })
    )
  })

  it.each(['success', 'cancel'])('repairs the missing Amp CLI through the Agent installer (%s)', async (outcome) => {
    const id = 'amp-acp'
    navigation.search = { id }
    vi.mocked(popup.confirm).mockResolvedValueOnce(outcome !== 'cancel')
    const actions: string[] = []
    vi.mocked(ipcApi.request).mockImplementation(async (route, input) => {
      if (route === 'file.select_folder') return '/test/project' as never
      if (route === 'ai.local_agents.detect') return [{ presetId: id, path: '/user/bin/adapter' }] as never
      if (route === 'ai.local_agents.install') {
        expect(input).toEqual({ presetId: id, targetVersion: undefined })
        actions.push('install')
        return { ok: true, reused: true, path: '/user/bin/adapter' } as never
      }
      if (route === 'ai.local_agents.open_terminal') actions.push('open')
      return { models: [], success: true } as never
    })
    render(<LocalAgentDirectory />)
    await userEvent.click(await screen.findByRole('button', { name: '在终端打开命令行' }))
    await userEvent.click(screen.getByRole('button', { name: '选择文件夹' }))
    await userEvent.click(screen.getByRole('button', { name: '启动' }))
    await waitFor(() => {
      if (outcome === 'success') expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      else expect(screen.getByRole('button', { name: '启动' })).toBeEnabled()
    })
    expect(popup.confirm).toHaveBeenCalledWith(expect.objectContaining({ content: 'amp: 未安装', okText: '安装' }))
    expect(actions).toEqual(outcome === 'success' ? ['install', 'open'] : [])
  })

  it('does not offer reinstalling an agent while its installation is still unknown', () => {
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') return new Promise(() => {}) as never
      return { models: [] } as never
    })
    render(<LocalAgentDirectory />)
    expect(screen.queryByRole('button', { name: '安装' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: '程序' })).getByRole('status')).not.toHaveTextContent('未安装')
  })

  it('offers installation instead of connection and chat for an uninstalled agent', async () => {
    navigation.search = { id: 'codex' }
    vi.mocked(ipcApi.request).mockResolvedValue([{ presetId: 'codex', source: 'none' }] as never)
    render(<LocalAgentDirectory />)
    expect(await screen.findByRole('button', { name: '安装' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '在终端打开命令行' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '检查连接' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '对话' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('heading', { name: 'Codex' })).getByRole('link', { name: 'Codex' })).toHaveAttribute(
      'href',
      'https://developers.openai.com/codex/cli'
    )
  })

  it.each([true, false])('opens the selected local agent only when enabled: %s', async (enabled) => {
    publishAgent(localAgent('Claude Code', { presetId: 'claude', enabled }, 'local-claude'))
    render(<LocalAgentDirectory />)
    await screen.findByRole('button', { name: '检查连接' })
    const button = screen.getByRole('button', { name: '对话' })
    if (enabled) {
      expect(button).toBeEnabled()
    } else {
      expect(button).toBeDisabled()
      await userEvent.hover(button.parentElement!)
      expect(await screen.findByRole('tooltip')).toHaveTextContent('点击右侧开关启用后，即可对话。')
      await userEvent.unhover(button.parentElement!)
    }
    await userEvent.click(button)
    const navigationCalls = vi
      .mocked(ipcApi.request)
      .mock.calls.filter(([route]) => route === 'navigation.open_route_in_main')
    expect(navigationCalls).toEqual(
      enabled ? [['navigation.open_route_in_main', { path: '/app/agents?agentId=local-claude' }]] : []
    )
  })

  it.each(['matching', 'other', 'none'])('closes settings and reuses an agent tab: %s', async (existing) => {
    publishAgent(localAgent('Claude Code', { presetId: 'claude' }, 'local-claude'))
    MockDataApiUtils.setCustomResponse('/agent-sessions/latest', 'GET', { session: { id: 'target-session' } })
    let tabs: Tab[] = [{ id: 'settings', type: 'route', title: 'Settings', url: '/settings/local-agents' }]
    if (existing !== 'none')
      tabs.push({
        id: 'agent-tab',
        type: 'route',
        title: 'Agent',
        url: `/app/agents?sessionId=${existing === 'matching' ? 'target-session' : 'other-session'}`
      })
    tabs.push({ id: 'unrelated', type: 'route', title: 'Other', url: '/app/chat' })
    let activeTabId = 'settings'
    const context: TabsContextValue = {
      tabs,
      activeTabId,
      activeTab: tabs[0],
      isLoading: false,
      updateTab: (id, changes) => {
        tabs = tabs.map((tab) => (tab.id === id ? { ...tab, ...changes } : tab))
      },
      closeTabs: (ids, activateId) => {
        tabs = tabs.filter((tab) => !ids.includes(tab.id))
        activeTabId = activateId ?? activeTabId
      },
      setActiveTab: (id) => {
        activeTabId = id
      },
      addTab: vi.fn(),
      closeTab: vi.fn(),
      openTab: vi.fn(),
      pinTab: vi.fn(),
      unpinTab: vi.fn(),
      reorderTabs: vi.fn(),
      detachTab: vi.fn(),
      attachTab: vi.fn()
    }
    render(
      <TabsContext value={context}>
        <TabIdContext value="settings">
          <LocalAgentDirectory />
        </TabIdContext>
      </TabsContext>
    )
    await userEvent.click(await screen.findByRole('button', { name: '对话' }))
    await waitFor(() => expect(tabs.some((tab) => tab.url.startsWith('/settings'))).toBe(false))
    expect(tabs).toHaveLength(2)
    expect(tabs.find((tab) => tab.id === activeTabId)?.url).toBe('/app/agents?sessionId=target-session')
    expect(tabs.find((tab) => tab.id === 'unrelated')?.url).toBe('/app/chat')
  })

  it.each([
    ['opencode', 'ai.local_agents.web_stop', false],
    ['codebuddy-code', 'ai.codebuddy_web.stop', false],
    ['hermes', 'hermes_dashboard.stop', false],
    ['deepseek-harness', 'deepseek_harness.stop', false],
    ['claude', undefined, false],
    ['opencode', 'ai.local_agents.web_stop', true],
    ['hermes', 'hermes_dashboard.stop', true],
    ['deepseek-harness', 'deepseek_harness.stop', true]
  ] as const)('stops WebUI after disabling %s via %s (stop fails=%s)', async (presetId, stopRoute, fails) => {
    navigation.search = { id: presetId }
    let agent = localAgent(presetId, { presetId })
    publishAgent(agent)
    const stops: unknown[][] = []
    vi.mocked(ipcApi.request).mockImplementation(async (route, input) => {
      if (route === 'ai.local_agents.detect') return [{ presetId, path: '/test/cli' }] as never
      if (route === 'ai.agent.delete') {
        expect(input).toEqual({ agentId: agent.id, deleteSessions: true })
        agent = { ...agent, deletedAt: new Date().toISOString() }
        publishAgent(agent)
        return { deleted: true, deletedSessionIds: ['test-session'] }
      }
      if (
        route === 'ai.local_agents.web_stop' ||
        route === 'ai.codebuddy_web.stop' ||
        route === 'hermes_dashboard.stop' ||
        route === 'deepseek_harness.stop'
      ) {
        expect(agent.deletedAt).toBeDefined()
        stops.push(input ? [route, input] : [route])
        if (fails && route !== 'hermes_dashboard.stop' && route !== 'deepseek_harness.stop')
          throw new Error('stop failed')
        return { success: !fails, message: 'stop failed' } as never
      }
      return { models: [] } as never
    })
    render(<LocalAgentDirectory />)
    await userEvent.click(await screen.findByRole('switch', { name: '启用此智能体' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: '启用此智能体' })).toBeEnabled())
    expect(screen.getByRole('switch', { name: '启用此智能体' })).not.toBeChecked()
    expect(popup.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: `停用 ${presetId} 并归档其对话？`,
        okText: '停用并归档'
      })
    )
    expect(stops).toEqual(
      stopRoute ? [stopRoute === 'ai.local_agents.web_stop' ? [stopRoute, { presetId }] : [stopRoute]] : []
    )
    if (fails) expect(screen.getByText('停止服务失败，请重试。')).toBeVisible()
  })

  it.each(['cancel', 'failure'])(
    'leaves an enabled agent unchanged when archiving does not complete (%s)',
    async (outcome) => {
      const agent = localAgent('Claude Code', { presetId: 'claude' })
      publishAgent(agent)
      vi.mocked(popup.confirm).mockResolvedValueOnce(outcome !== 'cancel')
      const commands: string[] = []
      vi.mocked(ipcApi.request).mockImplementation(async (route) => {
        if (route === 'ai.local_agents.detect') return [{ presetId: 'claude', path: '/test/cli' }] as never
        if (route === 'ai.agent.delete') {
          commands.push(route)
          throw new Error('archive failed')
        }
        return { models: [] } as never
      })
      render(<LocalAgentDirectory />)
      await userEvent.click(await screen.findByRole('switch', { name: '启用此智能体' }))
      await waitFor(() => expect(screen.getByRole('switch', { name: '启用此智能体' })).toBeEnabled())
      expect(screen.getByRole('switch', { name: '启用此智能体' })).toBeChecked()
      expect(commands).toEqual(outcome === 'cancel' ? [] : ['ai.agent.delete'])
      if (outcome === 'failure') expect(screen.getByText('archive failed')).toBeVisible()
    }
  )

  it.each([false, true])('restores the existing archived agent (fails=%s)', async (fails) => {
    let agent: AgentEntity = {
      ...localAgent('Claude Code', {
        presetId: 'claude',
        nativeModel: 'saved-model',
        executableOverride: '/test/saved-cli',
        args: ['saved-arg'],
        env: { SAVED: 'yes' }
      }),
      deletedAt: new Date().toISOString()
    }
    publishAgent(agent)
    vi.mocked(ipcApi.request).mockImplementation(async (route, input) => {
      if (route === 'ai.local_agents.detect') return [{ presetId: 'claude', path: '/test/cli' }] as never
      if (route === 'ai.local_agents.check') return { ok: true, status: 'ready' } as never
      if (route === 'ai.agent.restore') {
        expect(input).toEqual({ agentId: agent.id })
        if (fails) throw new Error('restore failed')
        agent = { ...agent, deletedAt: undefined }
        publishAgent(agent)
        return agent
      }
      return { models: [] } as never
    })
    render(<LocalAgentDirectory />)
    const toggle = await screen.findByRole('switch', { name: '启用此智能体' })
    expect(toggle).not.toBeChecked()
    expect(screen.getByRole('button', { name: '高级设置' })).toBeDisabled()
    await userEvent.click(toggle)
    await waitFor(() => expect(screen.getByRole('switch', { name: '启用此智能体' })).toBeEnabled())
    expect(screen.getByRole('switch', { name: '启用此智能体' })).toHaveAttribute('aria-checked', String(!fails))
    expect(screen.getByRole('button', { name: '对话' })).toHaveProperty('disabled', fails)
  })

  it.each([
    ['custom ACP', localAgent('My ACP', { executableOverride: '/test/custom-acp' }, 'my-acp')],
    [
      'legacy record with a built-in name',
      { ...localAgent('DeepSeek Harness', {}, 'legacy-deepseek'), localRuntime: undefined }
    ]
  ])('archives a confirmed deletion for a %s and removes the record from the services list', async (_, agent) => {
    publishAgent(agent)
    navigation.search = { id: agent.id }
    const confirm = vi.mocked(popup.confirm)
    confirm.mockReset().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const request = vi.mocked(ipcApi.request)
    const respond = request.getMockImplementation()!
    const archives: unknown[] = []
    request.mockImplementation(async (...args) => {
      if (args[0] !== 'ai.agent.delete') return respond(...args)
      archives.push(args[1])
      publishAgent({ ...agent, deletedAt: '2026-11-26T00:00:00.000Z' })
      return { deleted: true, deletedSessionIds: ['my-session'] } as never
    })

    const user = userEvent.setup()
    const { rerender } = render(<LocalAgentDirectory />)
    const remove = async () => {
      await user.click(screen.getByRole('button', { name: `${agent.name} · 更多` }))
      await user.click(await screen.findByRole('menuitem', { name: '删除' }))
    }
    expect(screen.queryByRole('button', { name: 'Claude Code · 更多' })).not.toBeInTheDocument()
    await remove()
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('heading', { name: agent.name })).toBeVisible()
    expect(archives).toEqual([])

    await remove()
    await waitFor(() => expect(archives).toEqual([{ agentId: agent.id, deleteSessions: true }]))
    rerender(<LocalAgentDirectory />)
    expect(screen.queryByRole('button', { name: `${agent.name} · 更多` })).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: (name) => name.startsWith(`${agent.name} · `) })).toHaveLength(
      agent.localRuntime ? 0 : 1
    )
    expect(screen.getByRole('button', { name: /DeepSeek Harness ·/ })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Claude Code' })).toBeVisible()
  })

  it('waits for an archived custom agent without opening a new-configuration drawer', async () => {
    navigation.search = { id: 'archived-custom' }
    const { rerender } = render(<LocalAgentDirectory />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    publishAgent({
      ...localAgent('Saved custom Agent', {}, 'archived-custom'),
      deletedAt: new Date().toISOString()
    })
    rerender(<LocalAgentDirectory />)
    expect(screen.getByRole('heading', { name: 'Saved custom Agent' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Saved custom Agent · 已启用' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '高级设置' }))
    expect(screen.getByLabelText('自定义可执行程序路径')).toBeEnabled()
    expect(screen.getByRole('button', { name: '启用此智能体' })).toBeVisible()
  })

  it('selects the new agent when an existing settings page receives another deep link', async () => {
    const { rerender } = render(<LocalAgentDirectory />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Claude Code')
    navigation.search = { id: 'codex' }
    rerender(<LocalAgentDirectory />)
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Codex'))
  })

  it('keeps a dirty draft on cancellation and follows a retried link only after discard', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<LocalAgentDirectory />)
    await user.click(screen.getByRole('button', { name: '高级设置' }))
    await user.type(screen.getByRole('textbox', { name: /可执行程序/ }), '/tmp/my-claude')
    navigation.search = { id: 'codex' }
    rerender(<LocalAgentDirectory />)
    const confirmation = await screen.findByRole('alert')
    expect(confirmation).toHaveTextContent('放弃未保存的修改？')
    expect(screen.getByRole('heading', { level: 1, hidden: true })).toHaveTextContent('Claude Code')
    await user.click(within(confirmation).getByRole('button', { name: '取消' }))
    expect(screen.getByRole('textbox', { name: /可执行程序/ })).toHaveValue('/tmp/my-claude')
    expect(navigation.search.id).toBe('claude')
    rerender(<LocalAgentDirectory />)
    navigation.search = { id: 'codex' }
    rerender(<LocalAgentDirectory />)
    await user.click(await screen.findByRole('button', { name: '放弃修改' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Codex'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('selects an agent with Enter', async () => {
    const user = userEvent.setup()
    render(<LocalAgentDirectory />)
    const codex = await screen.findByRole('button', { name: /^Codex ·/ })
    await waitFor(() => expect(screen.getByRole('button', { name: '重新检测' })).toBeEnabled())
    codex.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Codex'))
  })

  it('opens another agent’s actions from the keyboard without selecting its row', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <LocalAgentDirectory
        getRowMenuItems={(id) =>
          id === 'codex' ? [{ type: 'item', id: 'pin-codex', label: '固定 Codex', onSelect }] : []
        }
      />
    )

    const menuButton = await screen.findByRole('button', { name: 'Codex · 更多' })
    menuButton.focus()
    await user.keyboard('{Enter}')
    await user.click(await screen.findByRole('menuitem', { name: '固定 Codex' }))

    await waitFor(() => expect(onSelect).toHaveBeenCalledOnce())
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Claude Code')
  })

  it('ignores stale discovery results after a newer availability update', async () => {
    vi.mocked(useIpcOn).mockClear()
    navigation.search = { id: 'cli:openclaw' }
    MockUseDataApiUtils.mockQueryData('/agents', { items: [], total: 0, page: 1 })
    let finishOld!: (value: unknown) => void
    let finishNew!: (value: unknown) => void
    const oldDetection = new Promise((resolve) => {
      finishOld = resolve
    })
    const newDetection = new Promise((resolve) => {
      finishNew = resolve
    })
    let calls = 0
    vi.mocked(ipcApi.request).mockImplementation((route) => {
      if (route === 'ai.local_agents.detect') return (++calls === 1 ? oldDetection : newDetection) as never
      return Promise.resolve({}) as never
    })
    render(<LocalAgentDirectory />)
    const handler = vi
      .mocked(useIpcOn)
      .mock.calls.find(([name]) => name === 'binary.availability_changed')![1] as () => void
    act(() => {
      handler()
    })
    await act(async () => {
      finishNew([{ presetId: 'claude', path: '/new/claude' }])
    })
    expect(screen.getByRole('button', { name: 'Claude Code · 已安装' })).toBeInTheDocument()
    await act(async () => {
      finishOld([])
    })
    expect(screen.getByRole('button', { name: 'Claude Code · 已安装' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新检测' })).toBeEnabled()
  })

  it('rejects invalid draft JSON before saving and retains the draft for correction', async () => {
    const user = userEvent.setup()
    render(<LocalAgentDirectory />)
    await user.click(screen.getByRole('button', { name: '高级设置' }))
    const args = screen.getByLabelText('启动参数（JSON 数组）')
    await user.clear(args)
    await user.type(args, 'invalid json')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await within(screen.getByRole('dialog')).findByRole('status')).toHaveTextContent(
      '启动参数必须是 JSON 字符串数组。'
    )
    expect(args).toHaveValue('invalid json')
    await user.clear(args)
    fireEvent.change(args, { target: { value: '[]' } })
    const env = screen.getByLabelText('环境变量（JSON 对象）')
    fireEvent.change(env, { target: { value: '{"TEST":1}' } })
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await within(screen.getByRole('dialog')).findByRole('status')).toHaveTextContent(
      '环境变量必须是 JSON 对象，变量名须有效，值须为字符串。'
    )
  })

  it('defaults built-in browser control to Disabled for custom ACP and persists opt-in changes', async () => {
    for (const method of [
      'hasPointerCapture',
      'setPointerCapture',
      'releasePointerCapture',
      'scrollIntoView'
    ] as const) {
      if (!(method in HTMLElement.prototype)) {
        Object.defineProperty(HTMLElement.prototype, method, {
          configurable: true,
          value: method === 'hasPointerCapture' ? () => false : () => {}
        })
      }
    }
    const user = userEvent.setup()
    navigation.search = { id: 'custom-agent' }
    const agent = localAgent('Custom Agent', { executableOverride: '/test/custom-acp' }, 'custom-agent')
    publishAgent(agent)
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') return [] as never
      if (route === 'ai.local_agents.check') return { ok: true, status: 'ready' } as never
      if (route === 'ai.local_agents.update_settings') return agent
      return { models: [] } as never
    })

    render(<LocalAgentDirectory />)
    await user.click(await screen.findByRole('button', { name: '高级设置' }))
    const combobox = within(screen.getByRole('dialog')).getByRole('combobox', { name: '内置浏览器控制' })
    expect(combobox).toHaveTextContent('禁用')

    await user.click(combobox)
    await user.click(await screen.findByRole('option', { name: '仅只读' }))
    const saveButton = within(screen.getByRole('dialog')).getByRole('button', { name: '保存' })
    expect(saveButton).toBeEnabled()
    await user.click(saveButton)

    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith(
        'ai.local_agents.update_settings',
        expect.objectContaining({
          agentId: agent.id,
          settings: expect.objectContaining({
            browserControl: 'readonly'
          })
        })
      )
    )
  })

  it('closes the creation drawer and selects the new custom ACP agent after saving from custom-new', async () => {
    const user = userEvent.setup()
    const created = localAgent(
      'My Custom ACP',
      { enabled: false, executableOverride: '/test/custom-acp', args: ['acp'] },
      'created-custom-id'
    )
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') return [] as never
      if (route === 'ai.local_agents.check') return { ok: true, status: 'ready' } as never
      if (route === 'ai.agent.create') {
        publishAgent(created)
        return created as never
      }
      return { models: [] } as never
    })

    const { rerender } = render(<LocalAgentDirectory />)
    await user.click(await screen.findByRole('button', { name: '自定义 ACP' }))

    // Simulate TanStack Router re-rendering with the updated ?id=custom-new search param.
    expect(navigation.search).toEqual({ id: 'custom-new' })
    rerender(<LocalAgentDirectory />)

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('名称'), 'My Custom ACP')
    await user.type(within(dialog).getByLabelText('自定义可执行程序路径'), '/test/custom-acp')
    fireEvent.change(within(dialog).getByLabelText('启动参数（JSON 数组）'), { target: { value: '["acp"]' } })
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(navigation.search).toEqual({ id: created.id }))
    rerender(<LocalAgentDirectory />)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByRole('heading', { name: 'My Custom ACP' })).toBeVisible()
  })
})
