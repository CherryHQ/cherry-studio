import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TabIdContext, TabsContext, type Tab, type TabsContextValue } from '@renderer/hooks/tab'
import { ipcApi } from '@renderer/ipc'

import { LocalAgentSettingsPage } from '../LocalAgentSettingsPage'

const navigation = vi.hoisted(() => ({ search: { id: 'claude' }, navigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => navigation.search,
  useNavigate: () => navigation.navigate
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() }, useIpcOn: vi.fn() }))
vi.unmock('@cherrystudio/ui')

beforeEach(() => {
  navigation.search = { id: 'claude' }
  navigation.navigate.mockImplementation(({ search }: { search: { id: string } }) => {
    navigation.search = search
    return Promise.resolve()
  })
  vi.mocked(ipcApi.request).mockImplementation(async (route) =>
    route === 'ai.local_agents.detect' ? [{ presetId: 'claude', path: '/usr/local/bin/claude' }] : ([] as never)
  )
})

afterEach(() => vi.useRealTimers())

describe('local agent settings navigation', () => {
  it('shows the checked version inline, pauses dismissal on hover, and restores installation status', async () => {
    vi.mocked(ipcApi.request).mockImplementation(
      async (route) =>
        (route === 'ai.local_agents.detect'
          ? [{ presetId: 'claude', path: '/usr/local/bin/claude' }]
          : route === 'ai.local_agents.check'
            ? { ok: true, status: 'ready', version: '1.2.3' }
            : []) as never
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
            : []) as never
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
    await user.clear(screen.getByLabelText('名称'))
    await user.type(screen.getByLabelText('名称'), 'Temporary name')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '高级设置' }))
    expect(screen.getByLabelText('名称')).toHaveValue('Claude Code')
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

  it('offers installation instead of connection and chat for an uninstalled agent', async () => {
    navigation.search = { id: 'codex' }
    render(<LocalAgentSettingsPage />)
    expect(await screen.findByRole('button', { name: '安装' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '在终端打开命令行' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '检查连接' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '对话' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '登录帮助' })).toHaveAttribute(
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
    const button = await screen.findByRole('button', { name: '对话' })
    expect(button).toHaveProperty('disabled', !enabled)
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
          <LocalAgentSettingsPage />
        </TabIdContext>
      </TabsContext>
    )
    await userEvent.click(await screen.findByRole('button', { name: '对话' }))
    await waitFor(() => expect(tabs.some((tab) => tab.url.startsWith('/settings'))).toBe(false))
    expect(tabs).toHaveLength(2)
    expect(tabs.find((tab) => tab.id === activeTabId)?.url).toBe('/app/agents?sessionId=target-session')
    expect(tabs.find((tab) => tab.id === 'unrelated')?.url).toBe('/app/chat')
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
    await user.clear(screen.getByLabelText('名称'))
    await user.type(screen.getByLabelText('名称'), 'My Claude')
    navigation.search = { id: 'codex' }
    rerender(<LocalAgentSettingsPage />)
    const confirmation = await screen.findByRole('alert')
    expect(confirmation).toHaveTextContent('放弃未保存的修改？')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Claude Code')
    await user.click(within(confirmation).getByRole('button', { name: '取消' }))
    expect(screen.getByLabelText('名称')).toHaveValue('My Claude')
    expect(navigation.search.id).toBe('claude')
    rerender(<LocalAgentSettingsPage />)
    navigation.search = { id: 'codex' }
    rerender(<LocalAgentSettingsPage />)
    await user.click(await screen.findByRole('button', { name: '放弃修改' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Codex'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('rejects invalid draft JSON before saving and retains the draft for correction', async () => {
    const user = userEvent.setup()
    render(<LocalAgentSettingsPage />)
    await user.click(screen.getByRole('button', { name: '高级设置' }))
    const args = screen.getByLabelText('启动参数（JSON 数组）')
    await user.clear(args)
    await user.type(args, 'invalid json')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await within(screen.getByRole('dialog')).findByRole('status')).toHaveTextContent(/SyntaxError/)
    expect(args).toHaveValue('invalid json')
  })
})
