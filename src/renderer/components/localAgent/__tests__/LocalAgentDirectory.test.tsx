import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TabIdContext, TabsContext, type Tab, type TabsContextValue } from '@renderer/hooks/tab'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { AgentEntity } from '@shared/data/api/schemas/agents'

import { LocalAgentDirectory } from '../LocalAgentDirectory'

function LocalAgentSettingsPage() {
  return <LocalAgentDirectory />
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
  MockUseDataApiUtils.resetMocks()
  MockUseDataApiUtils.mockQueryData('/agents', { items: [], total: 0, page: 1 })
  navigation.search = { id: 'claude' }
  navigation.navigate.mockImplementation(({ search }: { search: { id: string } }) => {
    navigation.search = search
    return Promise.resolve()
  })
  vi.mocked(ipcApi.request).mockImplementation(async (route) =>
    route === 'ai.local_agents.detect'
      ? [{ presetId: 'claude', path: '/usr/local/bin/claude' }]
      : ({ models: [] } as never)
  )
})

afterEach(() => vi.useRealTimers())

describe('local agent settings navigation', () => {
  it('keeps failed installation discovery quiet until the user explicitly retries', async () => {
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') throw new Error('discovery unavailable')
      return { models: [] } as never
    })
    render(<LocalAgentSettingsPage />)
    const retry = screen.getByRole('button', { name: '重新检测' })
    await waitFor(() => expect(retry).toBeEnabled())
    expect(toast.error).not.toHaveBeenCalled()
    await userEvent.click(retry)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Error: discovery unavailable'))
  })

  it('does not report a launch failure while merely reading CodeBuddy WebUI status', async () => {
    navigation.search = { id: 'codebuddy-code' }
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect')
        return [{ presetId: 'codebuddy-code', path: '/usr/local/bin/codebuddy' }] as never
      if (route === 'ai.codebuddy_web.status') throw new Error('status unavailable')
      return { models: [] } as never
    })
    render(<LocalAgentSettingsPage />)
    await waitFor(() => expect(ipcApi.request).toHaveBeenCalledWith('ai.codebuddy_web.status'))
    expect(toast.error).not.toHaveBeenCalled()
  })

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
    render(<LocalAgentSettingsPage />)
    await userEvent.click(await screen.findByRole('button', { name: '停止' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('停止 WebUI 失败，请重试。'))
    expect(screen.getByRole('button', { name: '停止' })).toBeEnabled()
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
    const { rerender } = render(<LocalAgentSettingsPage />)
    const start = await screen.findByRole('button', { name: /^启动$/ })
    expect(start).toBeDisabled()
    await userEvent.click(start)
    expect(
      vi.mocked(ipcApi.request).mock.calls.some(([route]) => route.endsWith('.start') || route.endsWith('.web_start'))
    ).toBe(false)
    MockUseDataApiUtils.mockQueryData('/agents', {
      items: [
        {
          id: 'test-local',
          name: presetId,
          type: 'local',
          model: null,
          modelName: null,
          orderKey: 'a0',
          createdAt: '',
          updatedAt: '',
          configuration: { localRuntime: { protocol: 'acp', presetId, enabled: true, args: [], env: {} } }
        }
      ],
      total: 1,
      page: 1
    })
    rerender(<LocalAgentSettingsPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: /^启动$/ })).toBeEnabled())
  })

  it('keeps automatic authentication failures quiet and reports failures after a manual model refresh', async () => {
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') return [{ presetId: 'claude', path: '/usr/local/bin/claude' }] as never
      if (route === 'ai.local_agents.models') throw new Error('Authentication required')
      return { models: [] } as never
    })
    render(<LocalAgentSettingsPage />)
    await waitFor(() => expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.models', expect.anything()))
    expect(screen.getByRole('button', { name: '检查连接' })).toBeEnabled()
    expect(screen.queryByText('请先登录')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByText('请先登录')).toBeVisible()
  })

  it('shows the installed version without checking a connection and offers the discovered upgrade', async () => {
    vi.mocked(ipcApi.request).mockImplementation(async (route, input) => {
      if (route === 'ai.local_agents.detect')
        return [{ presetId: 'claude', path: '/usr/local/bin/claude', version: '1.0.0' }] as never
      if (route === 'ai.local_agents.version') return { current: '1.0.0', latest: '2.0.0', canUpgrade: true } as never
      if (route === 'ai.local_agents.install') {
        expect(input).toEqual({ presetId: 'claude', targetVersion: '2.0.0' })
        return { ok: true, reused: false, path: '/usr/local/bin/claude' } as never
      }
      return { models: [] } as never
    })
    render(<LocalAgentSettingsPage />)
    expect(await screen.findByText('v1.0.0')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: /升级.*2.0.0/ }))
    expect(await screen.findByText(/升级成功/)).toBeInTheDocument()
  })

  it.each([false, true])('keeps navigation usable while an upgrade is pending (fails=%s)', async (fails) => {
    const user = userEvent.setup()
    let finish!: () => void
    const upgrade = new Promise<void>((resolve) => {
      finish = resolve
    })
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'ai.local_agents.detect') return [{ presetId: 'claude', path: '/usr/local/bin/claude' }] as never
      if (route === 'ai.local_agents.version') return { current: '1.0.0', latest: '2.0.0', canUpgrade: true } as never
      if (route === 'ai.local_agents.install') {
        await upgrade
        if (fails) throw new Error('upgrade failed')
        return { ok: true, reused: false, path: '/usr/local/bin/claude' } as never
      }
      return { models: [] } as never
    })
    render(<LocalAgentSettingsPage />)
    await user.click(await screen.findByRole('button', { name: /升级.*2.0.0/ }))
    try {
      await user.click(screen.getByRole('button', { name: /^Codex ·/ }))
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Codex'))
      expect(screen.getByRole('button', { name: '安装' })).toBeEnabled()
      await user.click(screen.getByRole('button', { name: /^Claude Code ·/ }))
      expect(await screen.findByRole('button', { name: /升级.*2.0.0/ })).toBeDisabled()
      await user.click(screen.getByRole('button', { name: /^Codex ·/ }))
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Codex'))
      await act(async () => {
        finish()
        await upgrade
      })
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Codex')
      await user.click(screen.getByRole('button', { name: /^Claude Code ·/ }))
      expect(await screen.findByRole('button', { name: /升级.*2.0.0/ })).toBeEnabled()
    } finally {
      finish()
    }
  })

  it('shows the checked version inline, pauses dismissal on hover, and restores installation status', async () => {
    vi.mocked(ipcApi.request).mockImplementation(
      async (route) =>
        (route === 'ai.local_agents.detect'
          ? [{ presetId: 'claude', path: '/usr/local/bin/claude' }]
          : route === 'ai.local_agents.check'
            ? { ok: true, status: 'ready', version: '1.2.3' }
            : { models: [] }) as never
    )
    render(<LocalAgentSettingsPage />)
    const button = await screen.findByRole('button', { name: '检查连接' })
    const program = screen.getByRole('group', { name: '程序' })
    expect(within(program).getByRole('button', { name: '检查连接' })).toBe(button)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    fireEvent.click(button)
    await vi.waitFor(() => expect(within(program).getByRole('status')).toHaveTextContent('1.2.3'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.mouseEnter(program)
    void act(() => vi.advanceTimersByTime(4200))
    expect(within(program).getByRole('status')).toHaveTextContent('1.2.3')
    fireEvent.mouseLeave(program)
    void act(() => vi.advanceTimersByTime(4200))
    expect(within(program).getByRole('status')).toHaveTextContent('已安装')
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
    render(<LocalAgentSettingsPage />)
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

  it('keeps the drawer mounted for its exit animation and discards the draft before reopening', async () => {
    const user = userEvent.setup()
    render(<LocalAgentSettingsPage />)
    await user.click(screen.getByRole('button', { name: '高级设置' }))
    expect(screen.getByLabelText('名称')).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: /可执行程序/ }), '/tmp/temporary-agent')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '高级设置' }))
    expect(screen.getByLabelText('名称')).toHaveValue('Claude Code')
    expect(screen.getByRole('textbox', { name: /可执行程序/ })).toHaveValue('')
  })

  it('opens an installed native CLI without requiring ACP sign-in or enabling the agent', async () => {
    const user = userEvent.setup()
    render(<LocalAgentSettingsPage />)
    await user.click(await screen.findByRole('button', { name: '在终端打开命令行' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.open_terminal', {
        presetId: 'claude',
        protocol: 'claude',
        enabled: false,
        args: [],
        env: {}
      })
    )
  })

  it.each([true, false])(
    'requires confirmation before installing a missing terminal CLI (confirm=%s)',
    async (confirmed) => {
      navigation.search = { id: 'antigravity-acp' }
      vi.mocked(popup.confirm).mockResolvedValueOnce(confirmed)
      const actions: string[] = []
      vi.mocked(ipcApi.request).mockImplementation(async (route, input) => {
        if (route === 'ai.local_agents.detect')
          return [{ presetId: 'antigravity-acp', path: '/user/bin/agy_acp_server.par' }] as never
        if (route === 'binary.install_tool') {
          expect(input).toEqual({ name: 'agy' })
          actions.push('install')
        }
        if (route === 'ai.local_agents.open_terminal') actions.push('open')
        return { models: [], success: true } as never
      })
      render(<LocalAgentSettingsPage />)
      await userEvent.click(await screen.findByRole('button', { name: '在终端打开命令行' }))
      await waitFor(() => expect(screen.getByRole('button', { name: '在终端打开命令行' })).toBeEnabled())
      expect(popup.confirm).toHaveBeenCalledWith(expect.objectContaining({ content: 'agy: 未安装', okText: '安装' }))
      expect(actions).toEqual(confirmed ? ['install', 'open'] : [])
    }
  )

  it('offers installation instead of connection and chat for an uninstalled agent', async () => {
    navigation.search = { id: 'codex' }
    render(<LocalAgentSettingsPage />)
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
    MockUseDataApiUtils.mockQueryData('/agents', {
      items: [
        {
          id: 'local-claude',
          name: 'Claude Code',
          type: 'local',
          model: null,
          modelName: null,
          orderKey: 'a0',
          createdAt: '',
          updatedAt: '',
          configuration: { localRuntime: { protocol: 'claude', presetId: 'claude', enabled, args: [], env: {} } }
        }
      ],
      total: 1,
      page: 1
    })
    render(<LocalAgentSettingsPage />)
    await screen.findByRole('button', { name: '检查连接' })
    const button = screen.getByRole('button', { name: '对话' })
    if (enabled) {
      expect(button).toBeEnabled()
    } else {
      expect(button).toBeDisabled()
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
    MockUseDataApiUtils.mockQueryData('/agents', {
      items: [
        {
          id: 'local-claude',
          name: 'Claude Code',
          type: 'local',
          model: null,
          modelName: null,
          orderKey: 'a0',
          createdAt: '',
          updatedAt: '',
          configuration: { localRuntime: { protocol: 'claude', presetId: 'claude', enabled: true, args: [], env: {} } }
        }
      ],
      total: 1,
      page: 1
    })
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
    ['kimi', 'ai.local_agents.web_stop', false],
    ['qwen', 'ai.local_agents.web_stop', false],
    ['kilo', 'ai.local_agents.web_stop', false],
    ['codebuddy-code', 'ai.codebuddy_web.stop', false],
    ['hermes', 'hermes_dashboard.stop', false],
    ['claude', undefined, false],
    ['opencode', 'ai.local_agents.web_stop', true],
    ['hermes', 'hermes_dashboard.stop', true]
  ] as const)('stops WebUI after disabling %s via %s (stop fails=%s)', async (presetId, stopRoute, fails) => {
    navigation.search = { id: presetId }
    let agent: AgentEntity = {
      id: 'test-local',
      name: presetId,
      type: 'local' as const,
      model: null,
      modelName: null,
      orderKey: 'a0',
      createdAt: '',
      updatedAt: '',
      configuration: { localRuntime: { protocol: 'acp' as const, presetId, enabled: true, args: [], env: {} } }
    }
    const publishAgent = () => MockUseDataApiUtils.mockQueryData('/agents', { items: [agent], total: 1, page: 1 })
    publishAgent()
    const stops: unknown[][] = []
    vi.mocked(ipcApi.request).mockImplementation(async (route, input) => {
      if (route === 'ai.local_agents.detect') return [{ presetId, path: '/test/cli' }] as never
      if (route === 'ai.agent.delete') {
        expect(input).toEqual({ agentId: agent.id, deleteSessions: true })
        agent = { ...agent, deletedAt: new Date().toISOString() }
        publishAgent()
        return { deleted: true, deletedSessionIds: ['test-session'] }
      }
      if (
        route === 'ai.local_agents.web_stop' ||
        route === 'ai.codebuddy_web.stop' ||
        route === 'hermes_dashboard.stop'
      ) {
        expect(agent.deletedAt).toBeDefined()
        stops.push(input ? [route, input] : [route])
        if (fails && route !== 'hermes_dashboard.stop') throw new Error('stop failed')
        return { success: !fails, message: 'stop failed' } as never
      }
      return { models: [] } as never
    })
    render(<LocalAgentSettingsPage />)
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
    if (fails) expect(screen.getByText('停止 WebUI 失败，请重试。')).toBeVisible()
  })

  it.each(['cancel', 'failure'])(
    'leaves an enabled agent unchanged when archiving does not complete (%s)',
    async (outcome) => {
      const agent = {
        id: 'test-local',
        name: 'Claude Code',
        type: 'local' as const,
        model: null,
        modelName: null,
        orderKey: 'a0',
        createdAt: '',
        updatedAt: '',
        configuration: {
          localRuntime: { protocol: 'claude' as const, presetId: 'claude', enabled: true, args: [], env: {} }
        }
      }
      MockUseDataApiUtils.mockQueryData('/agents', { items: [agent], total: 1, page: 1 })
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
      render(<LocalAgentSettingsPage />)
      await userEvent.click(await screen.findByRole('switch', { name: '启用此智能体' }))
      await waitFor(() => expect(screen.getByRole('switch', { name: '启用此智能体' })).toBeEnabled())
      expect(screen.getByRole('switch', { name: '启用此智能体' })).toBeChecked()
      expect(commands).toEqual(outcome === 'cancel' ? [] : ['ai.agent.delete'])
      if (outcome === 'failure') expect(screen.getByText('archive failed')).toBeVisible()
    }
  )

  it.each([false, true])('restores an archived agent with its original configuration (fails=%s)', async (fails) => {
    let agent: AgentEntity = {
      id: 'test-local',
      name: 'Claude Code',
      type: 'local',
      model: null,
      modelName: null,
      orderKey: 'a0',
      createdAt: '',
      updatedAt: '',
      deletedAt: new Date().toISOString(),
      configuration: {
        localRuntime: {
          protocol: 'claude',
          presetId: 'claude',
          enabled: true,
          nativeModel: 'saved-model',
          executableOverride: '/test/saved-cli',
          args: ['saved-arg'],
          env: { SAVED: 'yes' }
        }
      }
    }
    const originalConfig = agent.configuration
    MockUseDataApiUtils.mockQueryData('/agents', { items: [agent], total: 1, page: 1 })
    vi.mocked(ipcApi.request).mockImplementation(async (route, input) => {
      if (route === 'ai.local_agents.detect') return [{ presetId: 'claude', path: '/test/cli' }] as never
      if (route === 'ai.local_agents.check') return { ok: true, status: 'ready' } as never
      if (route === 'ai.agent.restore') {
        expect(input).toEqual({ agentId: agent.id })
        if (fails) throw new Error('restore failed')
        agent = { ...agent, deletedAt: undefined }
        MockUseDataApiUtils.mockQueryData('/agents', { items: [agent], total: 1, page: 1 })
        return agent
      }
      return { models: [] } as never
    })
    render(<LocalAgentSettingsPage />)
    const toggle = await screen.findByRole('switch', { name: '启用此智能体' })
    expect(toggle).not.toBeChecked()
    expect(screen.getByRole('button', { name: '高级设置' })).toBeDisabled()
    await userEvent.click(toggle)
    await waitFor(() => expect(screen.getByRole('switch', { name: '启用此智能体' })).toBeEnabled())
    expect(screen.getByRole('switch', { name: '启用此智能体' })).toHaveAttribute('aria-checked', String(!fails))
    expect(agent.configuration).toEqual(originalConfig)
    expect(screen.getByRole('button', { name: '对话' })).toHaveProperty('disabled', fails)
  })

  it('waits for an archived custom agent without opening a new-configuration drawer', async () => {
    navigation.search = { id: 'archived-custom' }
    const { rerender } = render(<LocalAgentSettingsPage />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    MockUseDataApiUtils.mockQueryData('/agents', {
      items: [
        {
          id: 'archived-custom',
          name: 'Saved custom Agent',
          type: 'local',
          model: null,
          modelName: null,
          orderKey: 'a0',
          createdAt: '',
          updatedAt: '',
          deletedAt: new Date().toISOString(),
          configuration: { localRuntime: { protocol: 'acp', enabled: true, args: [], env: {} } }
        }
      ],
      total: 1,
      page: 1
    })
    rerender(<LocalAgentSettingsPage />)
    expect(screen.getByRole('heading', { name: 'Saved custom Agent' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Saved custom Agent · 已启用' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '高级设置' })).toBeDisabled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('selects the new agent when an existing settings page receives another deep link', async () => {
    const { rerender } = render(<LocalAgentSettingsPage />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Claude Code')
    navigation.search = { id: 'codex' }
    rerender(<LocalAgentSettingsPage />)
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Codex'))
  })

  it('keeps a dirty draft on cancellation and follows a retried link only after discard', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<LocalAgentSettingsPage />)
    await user.click(screen.getByRole('button', { name: '高级设置' }))
    await user.type(screen.getByRole('textbox', { name: /可执行程序/ }), '/tmp/my-claude')
    navigation.search = { id: 'codex' }
    rerender(<LocalAgentSettingsPage />)
    const confirmation = await screen.findByRole('alert')
    expect(confirmation).toHaveTextContent('放弃未保存的修改？')
    expect(screen.getByRole('heading', { level: 1, hidden: true })).toHaveTextContent('Claude Code')
    await user.click(within(confirmation).getByRole('button', { name: '取消' }))
    expect(screen.getByRole('textbox', { name: /可执行程序/ })).toHaveValue('/tmp/my-claude')
    expect(navigation.search.id).toBe('claude')
    rerender(<LocalAgentSettingsPage />)
    navigation.search = { id: 'codex' }
    rerender(<LocalAgentSettingsPage />)
    await user.click(await screen.findByRole('button', { name: '放弃修改' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Codex'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('selects an agent with Enter without starting a drag', async () => {
    const user = userEvent.setup()
    render(<LocalAgentSettingsPage />)
    const codex = await screen.findByRole('button', { name: /^Codex ·/ })
    await waitFor(() => expect(screen.getByRole('button', { name: '重新检测' })).toBeEnabled())
    codex.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Codex'))
    expect(screen.getAllByRole('button', { name: /^Codex ·/ })).toHaveLength(1)
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
    render(<LocalAgentDirectory renderCli={() => null} />)
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
    render(<LocalAgentSettingsPage />)
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
})
